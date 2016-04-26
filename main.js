var strftime = require('strftime')
var html = require('yo-yo')
var uniq = require('uniq')
var randomBytes = require('randombytes')

var root = document.querySelector('#content')
var state = {
  channels: [],
  channel: location.hash || '!status',
  nym: randomBytes(3).toString('hex'),
  lines: {},
  activity: {},
  scroll: {}
}
var heights = {}
var linkRegex = RegExp('((?:https?:|magnet:|ssb:|/ipfs/)\\S+)')
var linkPartRegex = RegExp('^' + linkRegex.source)

var memdb = require('memdb')
var chat = require('./index.js')(state.nym, memdb())
chat.on('join', function (channel) {
  state.channels.push(channel)
  uniq(state.channels)
  selectChannel(channel)
  update()
})
chat.on('peer', update)
chat.on('disconnect', update)
setInterval(update, 1000)

function selectChannel (channel) {
  if (!channel) return
  if (channel === '#!status') channel = '!status'
  state.channel = channel
  state.activity[channel] = false
}

chat.on('part', function (channel) {
  var ix = state.channels.indexOf(channel)
  if (ix >= 0) state.channels.splice(ix, 1)
  selectChannel(state.channels[Math.max(0,ix-1)] || '!status')
  update()
})

chat.on('say', function (channel, row) {
  if (!state.lines[channel]) state.lines[channel] = []
  state.lines[channel].push(row)
  state.lines[channel].sort(function (a, b) {
    return a.value.time < b.value.time ? -1 : 1
  })
  var nymre = RegExp('\\b' + chat.nym + '\\b')
  if (state.channel !== channel) {
    state.activity[channel] = nymre.test(row.value.message)
      ? 'mentioned' : 'activity'
  }
  var lines = root.querySelector('.lines')
  if (lines.scrollHeight - lines.clientHeight === lines.scrollTop) {
    // at bottom, scroll to bottom
    state.scroll[channel] = Number.MAX_VALUE
  }
  update()
})

function update () {
  html.update(root, render(state))
  var lines = root.querySelector('.lines')
  heights[state.channel] = {
    client: lines.clientHeight,
    scroll: lines.scrollHeight
  }
  lines.scrollTop = state.scroll[state.channel]
}
update()
window.addEventListener('resize', update)

var h = location.hash
chat.join('!status')
if (h && h !== '#') chat.join(h)

window.addEventListener('hashchange', function () {
  chat.join(location.hash)
})

window.addEventListener('keydown', function (ev) {
  if (!ev.ctrlKey) {
    root.querySelector('input[name="text"]').focus()
  }
  var code = ev.keyCode || ev.which
  var h = heights[state.channel]
  if (h && code === 33) { // PgUp
    ev.preventDefault()
    state.scroll[state.channel] -= h.client
    update()
  } else if (h && code === 34) { // PgDown
    ev.preventDefault()
    state.scroll[state.channel] += h.client
    update()
  } else if (ev.ctrlKey && (code === 74 || code === 40)) { // ^down, ^j
    ev.preventDefault()
    var ix = state.channels.indexOf(state.channel)
    selectChannel(state.channels[(ix+1)%state.channels.length])
    update()
  } else if (ev.ctrlKey && (code === 75 || code === 38)) { // ^up, ^k
    ev.preventDefault()
    var ix = state.channels.indexOf(state.channel)
    selectChannel(state.channels[(ix-1)%state.channels.length])
    update()
  }
})

var catchlinks = require('catch-links')
catchlinks(window, function (href) {
  var m = /(#.+)$/.exec(href)
  if (m) {
    selectChannel(m[1])
    update()
  }
})

function render (state) {
  location.hash = state.channel
  var scroll = state.scroll[state.channel] || 0
  return html`<div id="content">
    <div class="channels"><div class="inner">
      ${state.channels.map(function (channel) {
        var c = state.activity[channel] || ''
        if (state.channel === channel) c = 'current'
        return html`<div class="channel">
          <a onclick=${onclick} class="${c}">${channel}</a>
        </div>`
        function onclick (ev) {
          ev.preventDefault()
          selectChannel(channel)
          update()
        }
      })}
    </div></div>
    <div class="lines" onscroll=${onscroll} scroll=${scroll}><div class="inner">
      ${(state.lines[state.channel] || []).map(function (row) {
        var m = row.value
        var parts = m.message.split(linkRegex)
        return html`<div class="line">
          <span class="time">${strftime('%T', new Date(m.time))}</span>
          <span class="who">${'<' + m.who + '>'}</span>
          <span class="message">
            ${parts.map(function (part) {
              if (linkPartRegex.test(part)) {
                return html`<a href="${part}">${part}</a>`
              } else return part
            })}
          </span>
        </div>`
      })}
    </div></div>
    <div class="info">
      [${strftime('%T', new Date)}]
      [${chat.nym}]
      ${Object.keys(chat.peers[state.channel] || {}).length} peers
    </div>
    <form class="input" onsubmit=${onsubmit}>
      [${state.channel}]
      <input type="text" name="text" autofocus
        style="width: calc(100% - ${state.channel.length+6}ex)">
    </form>
  </div>`
  function onsubmit (ev) {
    ev.preventDefault()
    var msg = this.elements.text.value
    this.reset()
    handleMsg(msg)
  }
  function onscroll (ev) {
    state.scroll[state.channel] = this.scrollTop
  }
}

function handleMsg (msg) {
  var m = /^\/(\S+)/.exec(msg)
  var cmd = (m && m[1] || '').toLowerCase()
  if (cmd === 'join' || cmd === 'j') {
    chat.join(msg.split(/\s+/)[1] || state.channel)
  } else if (cmd === 'part' || cmd === 'p') {
    chat.part(msg.split(/\s+/)[1] || state.channel)
  } else if (cmd === 'nick' || cmd === 'n') {
    chat.nym = msg.split(/\s+/)[1]
    update()
  } else if (cmd === 'help' || cmd === 'h') {
    showHelp()
  } else if (cmd) {
    // unknown command
  } else if (state.channel !== '!status') {
    chat.say(state.channel, msg)
  }
}

var helpMessage = require('./help.js')
showHelp()

function showHelp () {
  helpMessage.split('\n').forEach(showInfo)
  update()
}

function showInfo (msg) {
  var lines = state.lines['!status']
  if (!lines) lines = state.lines['!status'] = []
  lines.push({
    value: {
      time: Date.now(),
      who: '!info',
      message: msg
    }
  })
}
