/**
 * @fileoverview Session
 */

/**
 * @augments JsSIP
 * @class Invite Session
 */
(function(JsSIP) {
var Session,
  LOG_PREFIX = JsSIP.name() +' | '+ 'SESSION' +' | ',
  C = {
    // Session states
    STATUS_NULL:               0,
    STATUS_INVITE_SENT:        1,
    STATUS_1XX_RECEIVED:       2,
    STATUS_INVITE_RECEIVED:    3,
    STATUS_WAITING_FOR_ANSWER: 4,
    STATUS_WAITING_FOR_ACK:    5,
    STATUS_CANCELED:           6,
    STATUS_TERMINATED:         7,
    STATUS_CONFIRMED:          8,

    // DTMF
    DTMF_DEFAULT_DURATION:        100,
    DTMF_MIN_DURATION:            70,
    DTMF_MAX_DURATION:            6000,
    DTMF_DEFAULT_INTER_TONE_GAP:  500,
    DTMF_MIN_INTER_TONE_GAP:      50
  };

Session = function(ua) {
  var events = [
  'connecting',
  'progress',
  'failed',
  'started',
  'ended',
  'newDTMF'
  ];

  this.ua = ua;
  this.status = C.STATUS_NULL;
  this.dialog = null;
  this.earlyDialogs = [];
  this.mediaSession = null;

  // Session Timers
  // A BYE will be sent if ACK for the response establishing the session is not received
  this.ackTimer = null;
  this.expiresTimer = null;
  this.invite2xxTimer = null;
  this.userNoAnswerTimer = null;

  // Session info
  this.direction = null;
  this.local_identity = null;
  this.remote_identity = null;
  this.start_time = null;
  this.end_time = null;

  // Custom session empty object for high user
  this.data = {};

  this.initEvents(events);
};
Session.prototype = new JsSIP.EventEmitter();


/*
 * Session Management
 */

/**
* @private
*/
Session.prototype.init_incoming = function(request) {
  // Session parameter initialization
  this.status = C.STATUS_INVITE_RECEIVED;
  this.from_tag = request.from_tag;
  this.id = request.call_id + this.from_tag;
  this.request = request;
  this.contact = this.ua.contact.toString();

  //Save the session into the ua sessions collection.
  this.ua.sessions[this.id] = this;

  this.receiveInitialRequest(request);
};

Session.prototype.connect = function(target, views, options) {
  var event, eventHandlers, request, selfView, remoteView, mediaTypes, extraHeaders, requestParams,
    invalidTarget = false;

  if (target === undefined || views === undefined) {
    throw new TypeError('Not enough arguments');
  }

  // Check views
  if (!(views instanceof Object)) {
    throw new TypeError('Invalid argument "views"');
  }

  if (!views.selfView || !(views.selfView instanceof HTMLVideoElement)) {
    throw new TypeError('Missing or invalid "views.selfView" argument');
  } else if (views.remoteView && !(views.remoteView instanceof HTMLVideoElement)) {
    throw new TypeError('Invalid "views.remoteView" argument');
  }

  // Check Session Status
  if (this.status !== C.STATUS_NULL) {
    throw new JsSIP.Exceptions.InvalidStateError(this.status);
  }

  // Get call options
  options = options || {};
  selfView = views.selfView || null;
  remoteView = views.remoteView || null;
  mediaTypes = options.mediaTypes || {audio: true, video: true};
  extraHeaders = options.extraHeaders || [];
  eventHandlers = options.eventHandlers || {};

  // Set event handlers
  for (event in eventHandlers) {
    this.on(event, eventHandlers[event]);
  }

  // Check target validity
  try {
    target = JsSIP.Utils.normalizeURI(target, this.ua.configuration.hostport_params);
  } catch(e) {
    target = JsSIP.URI.parse(JsSIP.C.INVALID_TARGET_URI);
    invalidTarget = true;
  }

  // Session parameter initialization
  this.from_tag = JsSIP.Utils.newTag();
  this.status = C.STATUS_NULL;
  this.mediaSession = new JsSIP.MediaSession(this, selfView, remoteView);

  // Set anonymous property
  this.anonymous = options.anonymous;

  // OutgoingSession specific parameters
  this.isCanceled = false;
  this.received_100 = false;

  requestParams = {from_tag: this.from_tag};

  this.contact = this.ua.contact.toString({
    anonymous: this.anonymous,
    outbound: true
  });

  if (this.anonymous) {
    requestParams.from_display_name = 'Anonymous';
    requestParams.from_uri = 'sip:anonymous@anonymous.invalid';

    extraHeaders.push('P-Preferred-Identity: '+ this.ua.configuration.uri.toString());
    extraHeaders.push('Privacy: id');
  }

  extraHeaders.push('Contact: '+ this.contact);
  extraHeaders.push('Allow: '+ JsSIP.Utils.getAllowedMethods(this.ua));
  extraHeaders.push('Content-Type: application/sdp');

  request = new JsSIP.OutgoingRequest(JsSIP.C.INVITE, target, this.ua, requestParams, extraHeaders);

  this.id = request.headers['Call-ID'] + this.from_tag;
  this.request = request;

  //Save the session into the ua sessions collection.
  this.ua.sessions[this.id] = this;

  this.newSession('local', request, target);
  this.connecting('local', request, target);

  if (invalidTarget) {
    this.failed('local', null, JsSIP.C.causes.INVALID_TARGET);
  } else if (!JsSIP.WebRTC.isSupported) {
    this.failed('local', null, JsSIP.C.causes.WEBRTC_NOT_SUPPORTED);
  } else {
    this.sendInitialRequest(mediaTypes);
  }
};

/**
* @private
*/
Session.prototype.close = function() {
  if(this.status !== C.STATUS_TERMINATED) {
    var session = this;

    console.log(LOG_PREFIX +'closing INVITE session ' + this.id);

    // 1st Step. Terminate media.
    if (this.mediaSession){
      this.mediaSession.close();
    }

    // 2nd Step. Terminate signaling.

    // Clear session timers
    window.clearTimeout(this.ackTimer);
    window.clearTimeout(this.expiresTimer);
    window.clearTimeout(this.invite2xxTimer);
    window.clearTimeout(this.userNoAnswerTimer);

    this.terminateEarlyDialogs();
    this.terminateConfirmedDialog();
    this.status = C.STATUS_TERMINATED;
  }
};

/*
 * Dialog Management
 */

/**
* @private
*/
Session.prototype.createEarlyDialog = function(message, type) {
  // Create an early Dialog given a message and type ('UAC' or 'UAS').
  var earlyDialog,
    local_tag = (type === 'UAS') ? message.to_tag : message.from_tag,
    remote_tag = (type === 'UAS') ? message.from_tag : message.to_tag,
    id = message.call_id + local_tag + remote_tag;

  if (this.earlyDialogs[id]) {
    return true;
  } else {
    earlyDialog = new JsSIP.Dialog(this, message, type, JsSIP.Dialog.C.STATUS_EARLY);

    // Dialog has been successfully created.
    if(earlyDialog.id) {
      this.earlyDialogs[id] = earlyDialog;
      return true;
    }
    // Dialog not created due to an error.
    else {
      return false;
    }
  }
};

/**
* @private
*/
Session.prototype.createConfirmedDialog = function(message, type) {
  // Create a confirmed dialog given a message and type ('UAC' or 'UAS')
  var dialog,
    local_tag = (type === 'UAS') ? message.to_tag : message.from_tag,
    remote_tag = (type === 'UAS') ? message.from_tag : message.to_tag,
    id = message.call_id + local_tag + remote_tag;

  dialog = this.earlyDialogs[id];
  // In case the dialog is in _early_ state, update it
  if (dialog) {
    dialog.update(message, type);
    this.dialog = dialog;
    delete this.earlyDialogs[id];
    return true;
  }

  // Otherwise, create a _confirmed_ dialog
  dialog = new JsSIP.Dialog(this, message, type);

  if(dialog.id) {
    this.to_tag = message.to_tag;
    this.dialog = dialog;
    return true;
  }
  // Dialog not created due to an error
  else {
    return false;
  }
};

/**
* @private
*/
Session.prototype.terminateConfirmedDialog = function() {
  // Terminate confirmed dialog
  if(this.dialog) {
    this.dialog.terminate();
    delete this.dialog;
  }
};

/**
* @private
*/
Session.prototype.terminateEarlyDialogs = function() {
  // Terminate early Dialogs
  var idx;

  for(idx in this.earlyDialogs) {
    this.earlyDialogs[idx].terminate();
    delete this.earlyDialogs[idx];
  }
};


/*
 * Request Reception
 */

/**
* @private
*/
Session.prototype.receiveRequest = function(request) {
  var contentType;

  if(request.method === JsSIP.C.CANCEL) {
    /* RFC3261 15 States that a UAS may have accepted an invitation while a CANCEL
    * was in progress and that the UAC MAY continue with the session established by
    * any 2xx response, or MAY terminate with BYE. JsSIP does continue with the
    * established session. So the CANCEL is processed only if the session is not yet
    * established.
    */

    // Reply 487
    this.request.reply(487);

    /*
    * Terminate the whole session in case the user didn't accept nor reject the
    *request opening the session.
    */
    if(this.status === C.STATUS_WAITING_FOR_ANSWER) {
      this.status = C.STATUS_CANCELED;
      this.failed('remote', request, JsSIP.C.causes.CANCELED);
    }
  } else {
    // Requests arriving here are in-dialog requests.
    switch(request.method) {
      case JsSIP.C.ACK:
        if(this.status === C.STATUS_WAITING_FOR_ACK) {
          window.clearTimeout(this.ackTimer);
          window.clearTimeout(this.invite2xxTimer);
          this.status = C.STATUS_CONFIRMED;
        }
        break;
      case JsSIP.C.BYE:
        if(this.status === C.STATUS_CONFIRMED) {
          request.reply(200);
          this.ended('remote', request, JsSIP.C.causes.BYE);
        }
        break;
      case JsSIP.C.INVITE:
        if(this.status === C.STATUS_CONFIRMED) {
          console.log(LOG_PREFIX +'re-INVITE received');
        }
        break;
      case JsSIP.C.INFO:
        if(this.status === C.STATUS_CONFIRMED || this.status === C.STATUS_WAITING_FOR_ACK) {
          contentType = request.getHeader('content-type');
          if (contentType && (contentType.match(/^application\/dtmf-relay/i))) {
            new Session.DTMF(this).init_incoming(request);
          }
        }
    }
  }
};


/*
 * Initial Request Reception
 */

/**
 * @private
 */
Session.prototype.receiveInitialRequest = function(request) {
  var body, contentType, expires,
    session = this;

  //Get the Expires header value if exists
  if(request.hasHeader('expires')) {
    expires = request.getHeader('expires') * 1000;
    this.expiresTimer = window.setTimeout(function() { session.expiresTimeout(request); }, expires);
  }

  // Process the INVITE request
  body = request.body;
  contentType = request.getHeader('Content-Type');

  // Request with sdp Offer
  if(body && (contentType === 'application/sdp')) {
    // ** Set the to_tag before replying a response code that will create a dialog
    request.to_tag = JsSIP.Utils.newTag();

    if(!this.createEarlyDialog(request, 'UAS')) {
      return;
    }

    this.status = C.STATUS_WAITING_FOR_ANSWER;

    this.userNoAnswerTimer = window.setTimeout(
      function() { session.userNoAnswerTimeout(request); },
      session.ua.configuration.no_answer_timeout
    );

    /**
    * Answer the call.
    * @param {HTMLVideoElement} selfView
    * @param {HTMLVideoElement} remoteView
    */
    this.answer = function(selfView, remoteView, options) {
      options = options || {};

      var offer, onSuccess, onMediaFailure, onSdpFailure,
        status_code = options.status_code || 200,
        reason_phrase = options.reason_phrase,
        extraHeaders = options.extraHeaders || [];

      if (status_code < 200 || status_code >= 300) {
        throw new TypeError('Invalid status_code: '+ status_code);
      }

      // Check Session Status
      if (this.status !== C.STATUS_WAITING_FOR_ANSWER) {
        throw new JsSIP.Exceptions.InvalidStateError(this.status);
      }

      offer = request.body;

      onSuccess = function() {
        var sdp = session.mediaSession.peerConnection.localDescription.sdp;

        if(!session.createConfirmedDialog(request, 'UAS')) {
          return;
        }

        extraHeaders.push('Contact: '+ session.contact);
        request.reply(status_code, reason_phrase, extraHeaders,
          sdp,
          // onSuccess
          function(){
            session.status = C.STATUS_WAITING_FOR_ACK;

            session.invite2xxTimer = window.setTimeout(
              function() {session.invite2xxRetransmission(1, request,sdp);},JsSIP.Timers.T1
            );

            window.clearTimeout(session.userNoAnswerTimer);

            session.ackTimer = window.setTimeout(
              function() { session.ackTimeout(); },
              JsSIP.Timers.TIMER_H
            );

            session.started('local');
          },
          // onFailure
          function() {
            session.failed('system', null, JsSIP.C.causes.CONNECTION_ERROR);
          }
        );
      };

      onMediaFailure = function(e) {
        console.warn(LOG_PREFIX +'unable to get user media: ' + e);
        request.reply(480);
        session.failed('local', null, JsSIP.C.causes.USER_DENIED_MEDIA_ACCESS);
      };

      onSdpFailure = function(e) {
        // Bad SDP Offer. peerConnection.setRemoteDescription throws an exception.
        console.warn(LOG_PREFIX +'invalid SDP: ' + e);
        request.reply(488);
        session.failed('remote', request, JsSIP.C.causes.BAD_MEDIA_DESCRIPTION);
      };

      //Initialize Media Session
      session.mediaSession = new JsSIP.MediaSession(session, selfView, remoteView);
      session.mediaSession.startCallee(onSuccess, onMediaFailure, onSdpFailure, offer);
    };

    // Fire 'call' event callback
    this.newSession('remote', request);

    // Reply with 180 if the session is not closed. It may be closed in the newSession event.
    if (this.status !== C.STATUS_TERMINATED) {
      this.progress('local');

      request.reply(180, null, ['Contact: '+ this.contact]);
    }
  } else {
    request.reply(415);
  }
};


/*
 * Reception of Response for Initial Request
 */

/**
 * @private
 */
Session.prototype.receiveResponse = function(response) {
  var cause, label,
    session = this;

  // Proceed to cancellation if the user requested.
  if(this.isCanceled) {
    if(response.status_code >= 100 && response.status_code < 200) {
      this.request.cancel(this.cancelReason);
    } else if(response.status_code >= 200 && response.status_code < 299) {
      this.acceptAndTerminate(response);
    }
    return;
  }

  switch(true) {
    case /^100$/.test(response.status_code):
      this.received_100 = true;
      break;
    case /^1[0-9]{2}$/.test(response.status_code):
      if(!response.to_tag) {
        // Do nothing with 1xx responses without To tag.
        break;
      }
      if(response.body) {
        label = '1xx_answer';
      } else {
        label = '1xx';
      }
      break;
    case /^2[0-9]{2}$/.test(response.status_code):
      if(response.body) {
        label = '2xx_answer';
      } else {
        label = '2xx';
      }
      break;
    default:
      label = 'failure';
  }

  // Process the response otherwise.
  if(this.status === C.STATUS_INVITE_SENT || this.status === C.STATUS_1XX_RECEIVED) {
    switch(label) {
      case 100:
        this.received_100 = true;
        break;
      case '1xx':
        // same logic for 1xx and 1xx_answer
      case '1xx_answer':
        // Create Early Dialog
        if (this.createEarlyDialog(response, 'UAC')) {
          this.status = C.STATUS_1XX_RECEIVED;
          this.progress('remote', response);
        }
        break;
      case '2xx':
        // Dialog confirmed already
        if (this.dialog) {
          if (response.to_tag === this.to_tag) {
            console.log(LOG_PREFIX +'2xx retransmission received');
          } else {
            console.log(LOG_PREFIX +'2xx received from an endpoint not establishing the dialog');
          }
          return;
        }

        this.acceptAndTerminate(response, 400, 'Missing session description');
        this.failed('remote', response, JsSIP.C.causes.BAD_MEDIA_DESCRIPTION);

        break;
      case '2xx_answer':
        // Dialog confirmed already
        if (this.dialog) {
          if (response.to_tag === this.to_tag) {
            console.log(LOG_PREFIX +'2xx_answer retransmission received');
          } else {
            console.log(LOG_PREFIX +'2xx_answer received from an endpoint not establishing the dialog');
          }
          return;
        }

        this.mediaSession.onMessage(
          'answer',
          response.body,
          /*
           * OnSuccess.
           * SDP Answer fits with Offer. MediaSession will start.
           */
          function() {
            if (session.createConfirmedDialog(response, 'UAC')) {
              session.sendACK();
              session.status = C.STATUS_CONFIRMED;
              session.started('remote', response);
            }
          },
          /*
           * OnFailure.
           * SDP Answer does not fit with Offer. Accept the call and Terminate.
           */
          function(e) {
            console.warn(e);
            session.acceptAndTerminate(response, 488, 'Not Acceptable Here');
            session.failed('remote', response, JsSIP.C.causes.BAD_MEDIA_DESCRIPTION);
          }
        );
        break;
      case 'failure':
        cause = JsSIP.Utils.sipErrorCause(response.status_code);
        this.failed('remote', response, cause);
        break;
    }
  }
};


/*
 * Timer Handlers
 */

/**
* RFC3261 14.2
* If a UAS generates a 2xx response and never receives an ACK,
*  it SHOULD generate a BYE to terminate the dialog.
* @private
*/
Session.prototype.ackTimeout = function() {
  if(this.status === C.STATUS_WAITING_FOR_ACK) {
    console.log(LOG_PREFIX + 'no ACK received, terminating the call');
    window.clearTimeout(this.invite2xxTimer);
    this.sendBye();

    this.ended('remote', null, JsSIP.C.causes.NO_ACK);
  }
};

/**
* RFC3261 13.3.1
* @private
*/
Session.prototype.expiresTimeout = function(request) {
  if(this.status === C.STATUS_WAITING_FOR_ANSWER) {
    request.reply(487);

    this.failed('system', null, JsSIP.C.causes.EXPIRES);
  }
};

/**
* RFC3261 13.3.1.4
* Response retransmissions cannot be accomplished by transaction layer
*  since it is destroyed when receiving the first 2xx answer
* @private
*/
Session.prototype.invite2xxRetransmission = function(retransmissions, request, body) {
  var timeout,
    session = this;

  timeout = JsSIP.Timers.T1 * (Math.pow(2, retransmissions));

  if((retransmissions * JsSIP.Timers.T1) <= JsSIP.Timers.T2) {
    retransmissions += 1;

    request.reply(200, null, ['Contact: '+ this.contact], body);

    this.invite2xxTimer = window.setTimeout(
      function() {
        session.invite2xxRetransmission(retransmissions, request, body);},
      timeout
    );
  } else {
    window.clearTimeout(this.invite2xxTimer);
  }
};

/**
* @private
*/
Session.prototype.userNoAnswerTimeout = function(request) {
  request.reply(408);

  this.failed('local',null, JsSIP.C.causes.NO_ANSWER);
};

/*
 * Private Methods
 */

/**
* @private
*/
Session.prototype.acceptAndTerminate = function(response, status_code, reason_phrase) {
  // Send ACK and BYE
  if (this.dialog || this.createConfirmedDialog(response, 'UAC')) {
    this.sendACK();
    this.sendBye({
      status_code: status_code,
      reason_phrase: reason_phrase
    });
  }
};

/**
* @private
*/
Session.prototype.sendACK = function() {
  var request = this.dialog.createRequest(JsSIP.C.ACK);

  this.sendRequest(request);
};

/**
* @private
*/
Session.prototype.sendBye = function(options) {
  options = options || {};

  var request, reason,
    status_code = options.status_code,
    reason_phrase = options.reason_phrase || JsSIP.C.REASON_PHRASE[status_code] || '',
    extraHeaders = options.extraHeaders || [],
    body = options.body;

  if (status_code && (status_code < 200 || status_code >= 700)) {
    throw new TypeError('Invalid status_code: '+ status_code);
  } else if (status_code) {
    reason = 'SIP ;cause=' + status_code + '; text="' + reason_phrase + '"';
    extraHeaders.push('Reason: '+ reason);
  }

  request = this.dialog.createRequest(JsSIP.C.BYE, extraHeaders);
  request.body = body;

  this.sendRequest(request);
};


Session.prototype.sendRequest = function(request) {
  var applicant, request_sender,
    self = this;

  applicant = {
    session: self,
    request: request,
    receiveResponse: function(){},
    onRequestTimeout: function(){},
    onTransportError: function(){}
  };

  request_sender = new Session.RequestSender(this, applicant);
  request_sender.send();
};

/*
 * Session Callbacks
 */

/**
* Callback to be called from UA instance when TransportError occurs
* @private
*/
Session.prototype.onTransportError = function() {
  if(this.status !== C.STATUS_TERMINATED) {
    if (this.status === C.STATUS_CONFIRMED) {
      this.ended('system', null, JsSIP.C.causes.CONNECTION_ERROR);
    } else {
      this.failed('system', null, JsSIP.C.causes.CONNECTION_ERROR);
    }
  }
};

/**
* Callback to be called from UA instance when RequestTimeout occurs
* @private
*/
Session.prototype.onRequestTimeout = function() {
  if(this.status !== C.STATUS_TERMINATED) {
    if (this.status === C.STATUS_CONFIRMED) {
      this.ended('system', null, JsSIP.C.causes.REQUEST_TIMEOUT);
    } else {
      this.failed('system', null, JsSIP.C.causes.CONNECTION_ERROR);
    }
  }
};

/**
 * Internal Callbacks
 */
Session.prototype.newSession = function(originator, request, target) {
  var session = this,
    event_name = 'newSession';

  session.direction = (originator === 'local') ? 'outgoing' : 'incoming';

  if (originator === 'remote') {
    session.local_identity = request.to.uri;
    session.remote_identity = request.from.uri;
  } else if (originator === 'local'){
    session.local_identity = session.ua.configuration.uri;
    session.remote_identity = target;
  }

  session.ua.emit(event_name, session.ua, {
    originator: originator,
    session: session,
    request: request
  });
};

Session.prototype.connecting = function(originator, request) {
  var session = this,
  event_name = 'connecting';

  session.emit(event_name, session, {
    originator: 'local',
    request: request
  });
};

Session.prototype.progress = function(originator, response) {
  var session = this,
    event_name = 'progress';

  session.emit(event_name, session, {
    originator: originator,
    response: response || null
  });
};

Session.prototype.started = function(originator, message) {
  var session = this,
    event_name = 'started';

  session.start_time = new Date();

  session.emit(event_name, session, {
    response: message || null
  });
};

Session.prototype.ended = function(originator, message, cause) {
  var session = this,
    event_name = 'ended';

  session.end_time = new Date();

  session.close();
  session.emit(event_name, session, {
    originator: originator,
    message: message || null,
    cause: cause
  });
};


Session.prototype.failed = function(originator, response, cause) {
  var session = this,
    event_name = 'failed';

  session.close();
  session.emit(event_name, session, {
    originator: originator,
    response: response,
    cause: cause
  });
};



/*
 * User API
 */

/**
* Terminate the call.
* @param {String} [reason]
*/
Session.prototype.terminate = function(options) {

  // Check Session Status
  if (this.status === C.STATUS_TERMINATED) {
    throw new JsSIP.Exceptions.InvalidStateError(this.status);
  }

  switch(this.status) {
    // - UAC -
    case C.STATUS_NULL:
    case C.STATUS_INVITE_SENT:
    case C.STATUS_1XX_RECEIVED:
      this.cancel(options);
      break;
      // - UAS -
    case C.STATUS_WAITING_FOR_ANSWER:
      this.reject(options);
      break;
    case C.STATUS_WAITING_FOR_ACK:
    case C.STATUS_CONFIRMED:
      // Send Bye
      this.sendBye(options);

      this.ended('local', null, JsSIP.C.causes.BYE);
      break;
  }

  this.close();
};

/**
 * Reject the incoming call
 * Only valid for incoming Messages
 *
 * @param {Number} status_code
 * @param {String} [reason_phrase]
 */
Session.prototype.reject = function(options) {
  options = options || {};

  var
    status_code = options.status_code || 480,
    reason_phrase = options.reason_phrase,
    extraHeaders = options.extraHeaders || [],
    body = options.body;

  // Check Session Direction and Status
  if (this.direction !== 'incoming') {
    throw new TypeError('Invalid method "reject" for an outgoing call');
  } else if (this.status !== C.STATUS_WAITING_FOR_ANSWER) {
    throw new JsSIP.Exceptions.InvalidStateError(this.status);
  }

  if (status_code < 300 || status_code >= 700) {
    throw new TypeError('Invalid status_code: '+ status_code);
  }

  this.request.reply(status_code, reason_phrase, extraHeaders, body);

  this.failed('local', null, JsSIP.C.causes.REJECTED);
};

/**
 * Cancel the outgoing call
 *
 * @param {String} [reason]
 */
Session.prototype.cancel = function(options) {
  options = options || {};

  var reason,
    status_code = options.status_code,
    reason_phrase = options.reason_phrase || JsSIP.C.REASON_PHRASE[status_code] || '';

  // Check Session Direction
  if (this.direction !== 'outgoing') {
    throw new TypeError('Invalid method "cancel" for an incoming call');
  }

  if (status_code && (status_code < 200 || status_code >= 700)) {
    throw new TypeError('Invalid status_code: '+ status_code);
  } else if (status_code) {
    reason = 'SIP ;cause=' + status_code + ' ;text="' + reason_phrase + '"';
  }

  // Check Session Status
  if (this.status === C.STATUS_NULL) {
    this.isCanceled = true;
    this.cancelReason = reason;
  } else if (this.status === C.STATUS_INVITE_SENT) {
    if(this.received_100) {
      this.request.cancel(reason);
    } else {
      this.isCanceled = true;
      this.cancelReason = reason;
    }
  } else if(this.status === C.STATUS_1XX_RECEIVED) {
    this.request.cancel(reason);
  } else {
    throw new JsSIP.Exceptions.InvalidStateError(this.status);
  }

  this.failed('local', null, JsSIP.C.causes.CANCELED);
};

/**
 * Send a DTMF
 *
 * @param {String|Number} tones
 * @param {Object} [options]
 */
Session.prototype.sendDTMF = function(tones, options) {
  var timer, interToneGap,
    possition = 0,
    self = this,
    ready = true;

  options = options || {};
  interToneGap = options.interToneGap || null;

  if (tones === undefined) {
    throw new TypeError('Not enough arguments');
  }

  // Check Session Status
  if (this.status !== C.STATUS_CONFIRMED && this.status !== C.STATUS_WAITING_FOR_ACK) {
    throw new JsSIP.Exceptions.InvalidStateError(this.status);
  }

  // Check tones
  if (!tones || (typeof tones !== 'string' && typeof tones !== 'number') || !tones.toString().match(/^[0-9A-D#*]+$/i)) {
    throw new TypeError('Invalid tones: '+ tones);
  }

  tones = tones.toString();

  // Check interToneGap
  if (interToneGap && !JsSIP.Utils.isDecimal(interToneGap)) {
    throw new TypeError('Invalid interToneGap: '+ interToneGap);
  } else if (!interToneGap) {
    interToneGap = C.DTMF_DEFAULT_INTER_TONE_GAP;
  } else if (interToneGap < C.DTMF_MIN_INTER_TONE_GAP) {
    console.warn(LOG_PREFIX +'"interToneGap" value is lower than the minimum allowed, setting it to '+ C.DTMF_MIN_INTER_TONE_GAP +' milliseconds');
    interToneGap = C.DTMF_MIN_INTER_TONE_GAP;
  } else {
    interToneGap = Math.abs(interToneGap);
  }

  function sendDTMF() {
    var tone,
      dtmf = new Session.DTMF(self);

    dtmf.on('failed', function(){ready = false;});

    tone = tones[possition];
    possition += 1;

    dtmf.send(tone, options);
  }

  // Send the first tone
  sendDTMF();

  // Send the following tones
  timer = window.setInterval(
    function() {
      if (self.status !== C.STATUS_TERMINATED && ready && tones.length > possition) {
          sendDTMF();
      } else {
        window.clearInterval(timer);
      }
    },
    interToneGap
  );
};

/**
 * Initial Request Sender
 */

/**
 * @private
 */
Session.prototype.sendInitialRequest = function(mediaTypes) {
  var
    self = this,
    request_sender = new JsSIP.RequestSender(self, this.ua);

  function onMediaSuccess() {
    if (self.isCanceled || self.status === C.STATUS_TERMINATED) {
      self.mediaSession.close();
      return;
    }

    // Set the body to the request and send it.
    self.request.body = self.mediaSession.peerConnection.localDescription.sdp;
    self.status = C.STATUS_INVITE_SENT;
    request_sender.send();
  }

  function onMediaFailure(e) {
    if (self.status !== C.STATUS_TERMINATED) {
      console.warn(LOG_PREFIX +'unable to get user media: ' + e);
      self.failed('local', null, JsSIP.C.causes.USER_DENIED_MEDIA_ACCESS);
    }
  }

  self.mediaSession.startCaller(mediaTypes, onMediaSuccess, onMediaFailure);
};



/**
 * Session Request Sender
 */

/**
 * @private
 */
Session.RequestSender = function(session, applicant) {
  this.session = session;
  this.request = applicant.request;
  this.applicant = applicant;
  this.reattempt = false;
  this.reatemptTimer = null;
  this.request_sender = new JsSIP.InDialogRequestSender(this);

};

Session.RequestSender.prototype = {
  receiveResponse: function(response) {
    var
      self = this,
      status_code = response.status_code;

    if (response.method === JsSIP.C.INVITE && status_code === 491) {
      if (!this.reattempt) {
        this.request.cseq.value = this.request.dialog.local_seqnum += 1;
        this.reatemptTimer = window.setTimeout(
          function() {
            if (self.session.status !== C.STATUS_TERMINATED) {
              self.reattempt = true;
              self.request_sender.send();
            }
          },
          this.getReattemptTimeout()
        );
      } else {
        this.applicant.receiveResponse(response);
      }
    } else {
      this.applicant.receiveResponse(response);
    }
  },

  send: function() {
    this.request_sender.send();
  },

  onRequestTimeout: function() {
    this.applicant.onRequestTimeout();
  },

  onTransportError: function() {
    this.applicant.onTransportError();
  },

  // RFC3261 14.1
  getReattemptTimeout: function() {
    if(this.session.direction === 'outgoing') {
      return (Math.random() * (4 - 2.1) + 2.1).toFixed(2);
    } else {
      return (Math.random() * 2).toFixed(2);
    }
  }
};

/**
 * Session DTMF
 */

/**
 * @private
 */

Session.DTMF = function(session) {
  var events = [
  'sending',
  'succeeded',
  'failed'
  ];

  this.session = session;
  this.direction = null;
  this.tone = null;
  this.duration = null;

  this.initEvents(events);
};
Session.DTMF.prototype = new JsSIP.EventEmitter();


Session.DTMF.prototype.send = function(tone, options) {
  var request_sender, event, eventHandlers, extraHeaders;

  if (tone === undefined) {
    throw new TypeError('Not enough arguments');
  }

  this.direction = 'outgoing';

  // Check Session Status
  if (this.session.status !== C.STATUS_CONFIRMED && this.session.status !== C.STATUS_WAITING_FOR_ACK) {
    throw new JsSIP.Exceptions.InvalidStateError(this.session.status);
  }

  // Get DTMF options
  options = options || {};
  extraHeaders = options.extraHeaders ? options.extraHeaders.slice() : [];
  eventHandlers = options.eventHandlers || {};

  // Check tone type
  if (typeof tone === 'string' ) {
    tone = tone.toUpperCase();
  } else if (typeof tone === 'number') {
    tone = tone.toString();
  } else {
    throw new TypeError('Invalid tone: '+ tone);
  }

  // Check tone value
  if (!tone.match(/^[0-9A-D#*]$/)) {
    throw new TypeError('Invalid tone: '+ tone);
  } else {
    this.tone = tone;
  }

  // Check duration
  if (options.duration && !JsSIP.Utils.isDecimal(options.duration)) {
    throw new TypeError('Invalid tone duration: '+ options.duration);
  } else if (!options.duration) {
    options.duration = C.DTMF_DEFAULT_DURATION;
  } else if (options.duration < C.DTMF_MIN_DURATION) {
    console.warn(LOG_PREFIX +'"duration" value is lower than the minimum allowed, setting it to '+ C.DTMF_MIN_DURATION+ ' milliseconds');
    options.duration = C.DTMF_MIN_DURATION;
  } else if (options.duration > C.DTMF_MAX_DURATION) {
    console.warn(LOG_PREFIX +'"duration" value is greater than the maximum allowed, setting it to '+ C.DTMF_MAX_DURATION +' milliseconds');
    options.duration = C.DTMF_MAX_DURATION;
  } else {
    options.duration = Math.abs(options.duration);
  }
  this.duration = options.duration;

  // Set event handlers
  for (event in eventHandlers) {
    this.on(event, eventHandlers[event]);
  }

  extraHeaders.push('Content-Type: application/dtmf-relay');

  this.request = this.session.dialog.createRequest(JsSIP.C.INFO, extraHeaders);

  this.request.body = "Signal= " + this.tone + "\r\n";
  this.request.body += "Duration= " + this.duration;

  request_sender = new Session.RequestSender(this.session, this);

  this.session.emit('newDTMF', this.session, {
    originator: 'local',
    dtmf: this,
    request: this.request
  });

  this.emit('sending', this, {
    originator: 'local',
    request: this.request
  });

  request_sender.send();
};

/**
 * @private
 */
Session.DTMF.prototype.receiveResponse = function(response) {
  var cause;

  switch(true) {
    case /^1[0-9]{2}$/.test(response.status_code):
      // Ignore provisional responses.
      break;

    case /^2[0-9]{2}$/.test(response.status_code):
      this.emit('succeeded', this, {
        originator: 'remote',
        response: response
      });
      break;

    default:
      cause = JsSIP.Utils.sipErrorCause(response.status_code);
      this.emit('failed', this, {
        originator: 'remote',
        response: response,
        cause: cause
      });
      break;
  }
};

/**
 * @private
 */
Session.DTMF.prototype.onRequestTimeout = function() {
  this.emit('failed', this, {
    originator: 'system',
    cause: JsSIP.C.causes.REQUEST_TIMEOUT
  });
};

/**
 * @private
 */
Session.DTMF.prototype.onTransportError = function() {
  this.emit('failed', this, {
    originator: 'system',
    cause: JsSIP.C.causes.CONNECTION_ERROR
  });
};

/**
 * @private
 */
Session.DTMF.prototype.init_incoming = function(request) {
  var body,
    reg_tone = /^(Signal\s*?=\s*?)([0-9A-D#*]{1})(\s)?.*/,
    reg_duration = /^(Duration\s?=\s?)([0-9]{1,4})(\s)?.*/;

  this.direction = 'incoming';
  this.request = request;

  request.reply(200);

  if (request.body) {
    body = request.body.split('\r\n');
    if (body.length === 2) {
      if (reg_tone.test(body[0])) {
        this.tone = body[0].replace(reg_tone,"$2");
      }
      if (reg_duration.test(body[1])) {
        this.duration = parseInt(body[1].replace(reg_duration,"$2"), 10);
      }
    }
  }

  if (!this.tone || !this.duration) {
    console.warn(LOG_PREFIX +'invalid INFO DTMF received, discarded');
  } else {
    this.session.emit('newDTMF', this.session, {
      originator: 'remote',
      dtmf: this,
      request: request
    });
  }
};

Session.C = C;
JsSIP.Session = Session;
}(JsSIP));
