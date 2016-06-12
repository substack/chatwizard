var hyperlog = require('hyperlog')
var keys = require('hyperreal/keys')
var swarm = require('webrtc-swarm')
var signalhub = require('signalhub')
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var has = require('has')
var wswarm = require('webrtc-swarm')
var through = require('through2')
var sub = require('subleveldown')
var shasum = require('shasum')

module.exports = Chat
inherits(Chat, EventEmitter)

var helpMessage = require('./help.js')

function Chat (nym, db) {
  if (!(this instanceof Chat)) return new Chat(nym, db)
  EventEmitter.call(this)
  this.db = db
  this.logs = {}
  this.swarms = {}
  this.peers = {}
  this.onswarm = {}
  this.ondisconnect = {}
  this.nym = nym
  this.hubs = [ 'https://signalhub.mafintosh.com/' ]
}

Chat.prototype.join = function (channel) {
  var self = this
  if (channel === '#!status') channel = '!status'
  if (channel === '!status') {
    return self.emit('join', channel)
  }
  if (has(self.swarms, channel)) {
    return self.emit('join', channel)
  }
  self.logs[channel] = hyperlog(
    sub(self.db, channel), { valueEncoding: 'json' })

  self.logs[channel].createReadStream({ live: true })
    .on('data', function (row) {
      self.emit('say', channel, row)
    })

  self.emit('join', channel)
  var hub = signalhub(shasum('chatwizard.' + channel), self.hubs)
  var swarm = wswarm(hub)
  self.swarms[channel] = swarm
  self.peers[channel] = {}
  self.onswarm[channel] = function (peer, id) {
    self.emit('peer', channel, id)
    self.peers[channel][id] = peer
    peer.pipe(self.logs[channel].replicate({ live: true })).pipe(peer)
  }
  self.ondisconnect[channel] = function (peer, id) {
    self.emit('disconnect', channel, id)
    delete self.peers[channel][id]
  }
  swarm.on('peer', self.onswarm[channel])
  swarm.on('disconnect', self.ondisconnect[channel])
}

Chat.prototype.part = function (channel) {
  var self = this
  if (!has(self.swarms, channel)) return
  delete self.logs[channel]
  self.swarms[channel].removeListener('peer', self.onswarm[channel])
  self.swarms[channel].removeListener('disconnect', self.ondisconnect[channel])
  delete self.swarms[channel]
  delete self.onswarm[channel]
  delete self.ondisconnect[channel]
  Object.keys(self.peers[channel]).forEach(function (key) {
    self.peers[channel][key].destroy()
  })
  delete self.peers[channel]
  self.emit('part', channel)
}

Chat.prototype.say = function (channel, msg) {
  if (!has(this.logs, channel)) return
  var data = {
    time: Date.now(),
    who: this.nym,
    message: msg
  }
  this.logs[channel].append(data, function (err, node) {})
}
