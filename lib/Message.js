const EventEmitter = require('events').EventEmitter;
const JsSIP_C = require('./Constants');
const SIPMessage = require('./SIPMessage');
const Utils = require('./Utils');
const RequestSender = require('./RequestSender');
const Transactions = require('./Transactions');
const Exceptions = require('./Exceptions');
const debug = require('debug')('JsSIP:Message');

module.exports = class Message extends EventEmitter
{
  constructor(ua)
  {
    super();

    this._ua = ua;
    this._request = null;
    this._closed = false;

    this._direction = null;
    this._local_identity = null;
    this._remote_identity = null;

    // Custom message empty object for high level use.
    this._data = {};
  }

  get direction()
  {
    return this._direction;
  }

  get local_identity()
  {
    return this._local_identity;
  }

  get remote_identity()
  {
    return this._remote_identity;
  }

  send(target, body, options = {})
  {
    const originalTarget = target;

    if (target === undefined || body === undefined)
    {
      throw new TypeError('Not enough arguments');
    }

    // Check target validity.
    target = this._ua.normalizeTarget(target);
    if (!target)
    {
      throw new TypeError(`Invalid target: ${originalTarget}`);
    }

    // Get call options.
    const extraHeaders = Utils.cloneArray(options.extraHeaders);
    const eventHandlers = options.eventHandlers || {};
    const contentType = options.contentType || 'text/plain';

    // Set event handlers.
    for (const event in eventHandlers)
    {
      if (Object.prototype.hasOwnProperty.call(eventHandlers, event))
      {
        this.on(event, eventHandlers[event]);
      }
    }

    extraHeaders.push(`Content-Type: ${contentType}`);

    this._request = new SIPMessage.OutgoingRequest(
      JsSIP_C.MESSAGE, target, this._ua, null, extraHeaders);

    if (body)
    {
      this._request.body = body;
    }

    const request_sender = new RequestSender(this._ua, this._request, {
      onRequestTimeout : () =>
      {
        this.onRequestTimeout();
      },
      onTransportError : () =>
      {
        this.onTransportError();
      },
      onReceiveResponse : (response) =>
      {
        this.receiveResponse(response);
      }
    });

    this.newMessage('local', this._request);

    request_sender.send();
  }

  receiveResponse(response)
  {
    if (this._closed)
    {
      return;
    }
    switch (true)
    {
      case /^1[0-9]{2}$/.test(response.status_code):
        // Ignore provisional responses.
        break;

      case /^2[0-9]{2}$/.test(response.status_code):
        this.succeeded('remote', response);
        break;

      default:
      {
        const cause = Utils.sipErrorCause(response.status_code);

        this.failed('remote', response, cause);
        break;
      }
    }
  }

  onRequestTimeout()
  {
    if (this._closed)
    {
      return;
    }
    this.failed('system', null, JsSIP_C.causes.REQUEST_TIMEOUT);
  }

  onTransportError()
  {
    if (this._closed)
    {
      return;
    }
    this.failed('system', null, JsSIP_C.causes.CONNECTION_ERROR);
  }

  close()
  {
    this._closed = true;
    this._ua.destroyMessage(this);
  }

  init_incoming(request)
  {
    this._request = request;

    this.newMessage('remote', request);

    const transaction = this._ua._transactions.nist[request.via_branch];

    if (transaction &&
        (transaction.state === Transactions.C.STATUS_TRYING ||
         transaction.state === Transactions.C.STATUS_PROCEEDING))
    {
      request.reply(200);
    }

    this.close();
  }

  /**
   * Accept the incoming Message
   * Only valid for incoming Messages
   */
  accept(options = {})
  {
    const extraHeaders = Utils.cloneArray(options.extraHeaders);
    const body = options.body;

    if (this._direction !== 'incoming')
    {
      throw new Exceptions.NotSupportedError('"accept" not supported for outgoing Message');
    }

    this._request.reply(200, null, extraHeaders, body);
  }

  /**
   * Reject the incoming Message
   * Only valid for incoming Messages
   */
  reject(options = {})
  {
    const status_code = options.status_code || 480;
    const reason_phrase = options.reason_phrase;
    const extraHeaders = Utils.cloneArray(options.extraHeaders);
    const body = options.body;

    if (this._direction !== 'incoming')
    {
      throw new Exceptions.NotSupportedError('"reject" not supported for outgoing Message');
    }

    if (status_code < 300 || status_code >= 700)
    {
      throw new TypeError(`Invalid status_code: ${status_code}`);
    }

    this._request.reply(status_code, reason_phrase, extraHeaders, body);
  }

  /**
   * Internal Callbacks
   */

  newMessage(originator, request)
  {
    if (originator === 'remote')
    {
      this._direction = 'incoming';
      this._local_identity = request.to;
      this._remote_identity = request.from;
    }
    else if (originator === 'local')
    {
      this._direction = 'outgoing';
      this._local_identity = request.from;
      this._remote_identity = request.to;
    }

    this._ua.newMessage(this, {
      originator,
      message : this,
      request
    });
  }

  failed(originator, response, cause)
  {
    debug('message failed');

    this.close();

    debug('emit "failed"');

    this.emit('failed', {
      originator,
      reponse : response || null,
      cause
    });
  }

  succeeded(originator, response)
  {
    debug('message succeeded');

    this.close();

    debug('emit "succeeded"');

    this.emit('succeeded', {
      originator,
      response
    });
  }
};
