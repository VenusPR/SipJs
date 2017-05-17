module.exports = Info;


/**
 * Dependencies.
 */
var util = require('util');
var events = require('events');
var debugerror = require('debug')('JsSIP:ERROR:RTCSession:Info');
debugerror.log = console.warn.bind(console);
var JsSIP_C = require('../Constants');
var Exceptions = require('../Exceptions');
var RTCSession = require('../RTCSession');


function Info(session) {
  this.owner = session;
  this.direction = null;
  this.contentType = null;
  this.body = null;

  events.EventEmitter.call(this);
}

util.inherits(Info, events.EventEmitter);

Info.prototype.send = function(contentType, body, options) {
  var extraHeaders;

  this.direction = 'outgoing';

  if (contentType === undefined) {
    throw new TypeError('Not enough arguments');
  }

  // Check RTCSession Status
  if (this.owner.status !== RTCSession.C.STATUS_CONFIRMED &&
    this.owner.status !== RTCSession.C.STATUS_WAITING_FOR_ACK) {
    throw new Exceptions.InvalidStateError(this.owner.status);
  }

  this.contentType = contentType;
  this.body = body;

  // Get Info options
  options = options || {};
  extraHeaders = options.extraHeaders ? options.extraHeaders.slice() : [];

  extraHeaders.push('Content-Type: '+ contentType);

  this.owner.newInfo({
    originator: 'local',
    info: this,
    request: this.request
  });

  this.owner.dialog.sendRequest(this, JsSIP_C.INFO, {
    extraHeaders: extraHeaders,
    body: body
  });
};

Info.prototype.receiveResponse = function(response) {
  switch(true) {
    case /^1[0-9]{2}$/.test(response.status_code):
      // Ignore provisional responses.
      break;

    case /^2[0-9]{2}$/.test(response.status_code):
      this.emit('succeeded', {
        originator: 'remote',
        response: response
      });
      break;

    default:
      this.emit('failed', {
        originator: 'remote',
        response: response
      });
      break;
  }
};

Info.prototype.onRequestTimeout = function() {
  debugerror('onRequestTimeout');
  this.owner.onRequestTimeout();
};

Info.prototype.onTransportError = function() {
  debugerror('onTransportError');
  this.owner.onTransportError();
};

Info.prototype.onDialogError = function() {
  debugerror('onDialogError');
  this.owner.onDialogError();
};

Info.prototype.init_incoming = function(request) {
  this.direction = 'incoming';
  this.request = request;

  request.reply(200);

  this.contentType = request.getHeader('content-type');
  this.body = request.body;

  this.owner.newInfo({
    originator: 'remote',
    info: this,
    request: request
  });
};
