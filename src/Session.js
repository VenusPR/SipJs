
/**
 * @fileoverview Invite Session
 */

/**
 * @augments JsSIP
 * @class Invite Session
 */
JsSIP.Session = (function() {

  var Session = function(ua, request, selfView, remoteView, mediaType) {
    var events = [
    'session_progress',
    'session_failed',
    'session_started',
    'session_ended'
    ];

    this.status = null;
    this.dialog = null;
    this.earlyDialogs = [];
    this.mediaSession = null;

    // Session Timers
    // A BYE will be sent if ACK for the response stablishing the session is not received
    this.ackTimer = null;
    this.expiresTimer = null;
    this.invite2xxTimer = null;
    this.userNoAnswerTimer = null;
    this.closeTimer = null;

    // Session info
    this.direction = null;
    this.local_identity = null;
    this.remote_identity = null;
    this.start_time = null;
    this.end_time = null;

    this.initEvents(events);

    // Self contact value. _gruu_ or not.
    if (ua.contact.pub_gruu) {
      this.contact = ua.contact.pub_gruu;
    } else {
      this.contact = ua.contact.uri;
    }

    if (request instanceof JsSIP.IncomingRequest) {
      this.init_incoming(ua, request);
    } else {
      this.init_outgoing(ua, request, selfView, remoteView, mediaType);
    }
  };
  Session.prototype = new JsSIP.EventEmitter();

  /*
   * Session Management
   */

  /**
  * @private
  */
  Session.prototype.init_incoming = function(ua, request) {
    // Session parameter initialization
    this.ua = ua;
    this.from_tag = request.from_tag;
    this.status = JsSIP.c.SESSION_INVITE_RECEIVED;
    this.id = request.call_id + this.from_tag;

    //Save the session into the ua sessions collection.
    this.ua.sessions[this.id] = this;

    this.receiveInitialRequest(ua, request);
  };

  /**
   * @private
   */
  Session.prototype.init_outgoing = function(ua, target, selfView, remoteView, mediaType) {
    var request;

    // Session parameter initialization
    this.ua = ua;
    this.from_tag = JsSIP.utils.newTag();
    this.status = JsSIP.c.SESSION_NULL;
    this.mediaSession = new JsSIP.MediaSession(this, selfView, remoteView);

    // OutgoingSession specific parameters
    this.isCanceled = false;
    this.received_100 = false;

    request = new JsSIP.OutgoingRequest(JsSIP.c.INVITE, target, ua, {
      from_tag: this.from_tag }, {
        'contact': '<' + this.contact + ';ob>',
        'allow': JsSIP.c.ALLOWED_METHODS,
        'content-type': 'application/sdp'
      });

    this.id = request.headers['Call-ID'] + this.from_tag;

    //Save the session into the ua sessions collection.
    this.ua.sessions[this.id] = this;

    this.send = function() {
      this.new_session('local', request, target);

      new InitialRequestSender(this, ua, request, mediaType);
    };

    /**
     * @private
     */
    this.cancel = function() {
      if (this.status === JsSIP.c.SESSION_INVITE_SENT) {
        if(this.received_100) {
          request.cancel();
        } else {
          this.isCanceled = true;
        }
      } else if(this.status === JsSIP.c.SESSION_1XX_RECEIVED) {
        request.cancel();
      }

      this.failed('local', null, JsSIP.c.causes.CANCELED);
    };
  };

  /**
  * @private
  */
  Session.prototype.close = function(event, sender, data) {
    if(this.status !== JsSIP.c.SESSION_TERMINATED) {
      var session = this;

      console.log(JsSIP.c.LOG_INVITE_SESSION +'Closing Invite Session ' + this.id);

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
      this.status = JsSIP.c.SESSION_TERMINATED;
      this.closeTimer = window.setTimeout(
        function() {
          if (session && session.ua.sessions[session.id]) {
            delete session.ua.sessions[session.id];
          }
        }, '5000'
      );
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
      earlyDialog = new JsSIP.Dialog(this, message, type, JsSIP.c.DIALOG_EARLY);

      // Dialog has been successfully created.
      if(earlyDialog) {
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

    if(dialog) {
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
    var reason,
      session = this;

    if(request.method === JsSIP.c.CANCEL) {
      /* RFC3261 15 States that a UAS may have accepted an invitation while a CANCEL
      * was in progrees and that the UAC MAY continue with the session stablished by
      * any 2xx response, or MAY terminate with BYE. JsSIP does continue with the
      *stablished session. So the CANCEL is processed only if the session is not yet
      *stablished.
      */

      // Transaction layer already responded 487 to the initial request.

      // Reply 200 to CANCEL
      request.reply(200, JsSIP.c.REASON_200);

      /*
      * Terminate the whole session in case the user didn't accept nor reject the
      *request oppening the session.
      */
      if(this.status === JsSIP.c.SESSION_WAITING_FOR_ANSWER) {
        reason = request.getHeader('Reason');

        this.status = JsSIP.c.SESSION_CANCELED;

        this.failed('remote', request, JsSIP.c.causes.CANCELED);
      }

    }
    // Requests different to CANCEL.
    // Requests arriving here are in-dialog requests.
    else {
      switch(request.method) {
        case JsSIP.c.ACK:
          if(this.status === JsSIP.c.SESSION_WAITING_FOR_ACK) {
            window.clearTimeout(this.ackTimer);
            window.clearTimeout(this.invite2xxTimer);
            this.status = JsSIP.c.SESSION_CONFIRMED;
          }
          break;
        case JsSIP.c.BYE:
          request.reply(200, JsSIP.c.REASON_200);

          this.ended('remote', request, JsSIP.c.causes.BYE);
          break;
        case JsSIP.c.INVITE:
          if(this.status === JsSIP.c.SESSION_CONFIRMED) {
            console.log(JsSIP.c.LOG_INVITE_SESSION +'Re-INVITE received');
          }
          break;
        case JsSIP.c.MESSAGE:
          JsSIP.messageReceiver(this.ua, request);
          break;
      }
    }
  };


  /*
   * Initial Request Reception
   */

  /**
   * @private
   */
  Session.prototype.receiveInitialRequest = function(ua, request) {
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
      request.to_tag = JsSIP.utils.newTag();

      if(!this.createEarlyDialog(request, 'UAS')) {
        return;
      }

      request.reply(180,
                    JsSIP.c.REASON_180, {
                      'Contact': '<' + this.contact + '>'}
                  );

      this.status = JsSIP.c.SESSION_WAITING_FOR_ANSWER;

      this.userNoAnswerTimer = window.setTimeout(
        function() { session.userNoAnswerTimeout(request); },
        ua.configuration.no_answer_timeout
      );

      /**
      * Answer the call.
      * @param {HTMLVideoElement} selfView
      * @param {HTMLVideoElement} remoteView
      */
      this.answer = function(selfView, remoteView) {
        var offer, onMediaSuccess, onMediaFailure, onSdpFailure;

        if(session.status === JsSIP.c.SESSION_WAITING_FOR_ANSWER) {
          offer = request.body;

          onMediaSuccess = function() {
            var sdp = session.mediaSession.peerConnection.localDescription.sdp;

            if(!session.createConfirmedDialog(request, 'UAS')) {
              return;
            }

            request.reply(200, JsSIP.c.REASON_200, {
              'Contact': '<' + session.contact + '>'},
              sdp,
              // onSuccess
              function(){
                session.status = JsSIP.c.SESSION_WAITING_FOR_ACK;

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
                session.failed('system', null, JsSIP.c.causes.CONNECTION_ERROR);
              }
            );
          };

          onMediaFailure = function(e) {
            // Unable to get User Media
            request.reply(486, JsSIP.c.REASON_486);
            session.failed('local', null, JsSIP.c.causes.USER_DENIED_MEDIA_ACCESS);
          };

          onSdpFailure = function(e) {
            /* Bad SDP Offer
            * peerConnection.setRemoteDescription thows an exception
            */
            console.log(JsSIP.c.LOG_SERVER_INVITE_SESSION +'PeerConnection Creation Failed: --'+e+'--');
            request.reply(488, JsSIP.c.REASON_488);
            session.failed('remote', request, JsSIP.causes.BAD_MEDIA_DESCRIPTION);
          };

          //Initialize Media Session
          session.mediaSession = new JsSIP.MediaSession(session, selfView, remoteView);
          session.mediaSession.startCallee(onMediaSuccess, onMediaFailure, onSdpFailure, offer);
        } else {
          console.warn(JsSIP.c.LOG_SERVER_INVITE_SESSION +'No call waiting for answer');
        }
      };

      /**
      * Reject the call
      * @private
      */
      this.reject = function() {
        if (this.status === JsSIP.c.SESSION_WAITING_FOR_ANSWER) {
          request.reply(486, JsSIP.c.REASON_486);

          this.failed('local', null, JsSIP.c.causes.REJECTED);
        }
      };

      // Fire 'call' event callback
      this.new_session('remote', request);
    } else {
      request.reply(415, JsSIP.c.REASON_415);
    }
  };


  /*
   * Reception of Response for Initial Request
   */

  /**
   * @private
   */
  Session.prototype.receiveInitialRequestResponse = function(label, response) {
    var cause,
    session = this;

    if(this.status === JsSIP.c.SESSION_INVITE_SENT || this.status === JsSIP.c.SESSION_1XX_RECEIVED) {
      switch(label) {
        case 100:
          this.received_100 = true;
          break;
        case '1xx':
          // same logic for 1xx and 1xx_answer
        case '1xx_answer':
          // Create Early Dialog
          if(!this.createEarlyDialog(response, 'UAC')) {
            break;
          }

          this.status = JsSIP.c.SESSION_1XX_RECEIVED;
          this.progress(response);
          break;
        case '2xx':
          // Dialog confirmed already
          if (this.dialog) {
            if (response.to_tag === this.to_tag) {
              console.log(JsSIP.c.LOG_CLIENT_INVITE_SESSION +'2xx retransmission received');
            } else {
              console.log(JsSIP.c.LOG_CLIENT_INVITE_SESSION +'2xx received from an endpoint not stablishing the dialog');
            }
            return;
          }

          this.acceptAndTerminate(response,'SIP ;cause= 400 ;text= "Missing session description"');

          session.ended('remote', response, JsSIP.c.causes.BAD_MEDIA_DESCRIPTION);

          break;
        case '2xx_answer':
          // Dialog confirmed already
          if (this.dialog) {
            if (response.to_tag === this.to_tag) {
              console.log(JsSIP.c.LOG_CLIENT_INVITE_SESSION +'2xx_answer retransmission received');
            } else {
              console.log(JsSIP.c.LOG_CLIENT_INVITE_SESSION +'2xx_answer received from an endpoint not stablishing the dialog');
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
              if(!session.createConfirmedDialog(response, 'UAC')) {
                return;
              }
              session.sendACK();
              session.status = JsSIP.c.SESSION_CONFIRMED;

              session.started('remote', response);
            },
            /*
             * OnFailure.
             * SDP Answer does not fit with Offer. Accept the call and Terminate.
             */
            function(e) {
              console.warn(e);
              session.acceptAndTerminate(response, 'SIP ;cause= 488 ;text= "Not Acceptable Here"');
              session.failed('remote', response, JsSIP.causes.BAD_MEDIA_DESCRIPTION);
            }
          );
          break;
        case 'failure':
          cause = JsSIP.utils.sipErrorCause(response.status_code);

          if (cause) {
            cause = JsSIP.c.causes[cause];
          } else {
            cause = JsSIP.c.causes.SIP_FAILURE_CODE;
          }

          session.failed('remote', response, cause);
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
    if(this.status === JsSIP.c.SESSION_WAITING_FOR_ACK) {
      console.log(JsSIP.c.LOG_INVITE_SESSION + 'No ACK received. Call will be terminated');
      window.clearTimeout(this.invite2xxTimer);
      this.sendBye();

      this.ended('remote', null, JsSIP.c.causes.NO_ACK);
    }
  };

  /**
  * RFC3261 13.3.1
  * @private
  */
  Session.prototype.expiresTimeout = function(request) {
    if(this.status === JsSIP.c.SESSION_WAITING_FOR_ANSWER) {
      request.reply(487, JsSIP.c.REASON_487);

      this.ended('system', null, JsSIP.c.causes.EXPIRES);
    }
  };

  /**
  * RFC3261 13.3.1.4
  * Response retransmisions cannot be accomplished by transaction layer
  *  since it is destroyed when receiving the first 2xx answer
  * @private
  */
  Session.prototype.invite2xxRetransmission = function(retransmissions, request, body) {
    var timeout,
      session = this;

    timeout = JsSIP.Timers.T1 * (Math.pow(2, retransmissions));

    if((retransmissions * JsSIP.Timers.T1) <= JsSIP.Timers.T2) {
      retransmissions += 1;

      request.reply(200, JsSIP.c.REASON_200, {
        'Contact': '<' + this.contact + '>'},
        body);

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
    request.reply(408, JsSIP.c.REASON_408);

    this.failed('local',null, JsSIP.c.causes.NO_ANSWER);
  };

  /*
   * Private Methods
   */

  /**
  * @private
  */
  Session.prototype.acceptAndTerminate = function(response, reason) {
    // Create _confirmed_ Dialog
    if(!this.createConfirmedDialog(response, 'UAC')) {
      return;
    }

      // Send ACK
      this.sendACK();

      // Now send a BYE and terminate the session
      this.sendBye(reason);
  };

  /**
  * @private
  */
  Session.prototype.sendACK = function() {
    var request, ackSender,
      session = this;

    function AckSender(request) {
      this.request = request;
      this.send = function() {
        var request_sender = new JsSIP.RequestSender(this, session.ua);
        request_sender.send();
      };
    }

    request = this.dialog.createRequest(JsSIP.c.ACK);
    ackSender = new AckSender(request);
    ackSender.send();
  };

  /**
  * @private
  */
  Session.prototype.sendBye = function(reason) {
    var request, byeSender,
      session = this;

    function ByeSender(request) {
      this.request = request;
      this.send = function() {
        var request_sender = new JsSIP.RequestSender(this, session.ua);
        request_sender.receiveResponse = function(response){};
        request_sender.send();
      };
    }

    reason = reason ? {'reason': reason} : {};
    request = this.dialog.createRequest(JsSIP.c.BYE, reason);
    byeSender = new ByeSender(request);

    byeSender.send();
  };

  /*
   * Session Callbacks
   */

  /**
  * Callback to be called from UA instance when TransportError occurs
  * @private
  */
  Session.prototype.onTransportError = function() {
    if(this.status !== JsSIP.c.TERMINATED) {
      this.ended('system', null, JsSIP.c.causes.CONNECTION_ERROR);
    }
  };

  /**
  * Callback to be called from UA instance when RequestTimeout occurs
  * @private
  */
  Session.prototype.onRequestTimeout = function() {
    if(this.status !== JsSIP.c.TERMINATED) {
      this.ended('system', null, JsSIP.c.causes.REQUEST_TIMEOUT);
    }
  };

  /**
   * Internal Callbacks
   */
  Session.prototype.new_session = function(originator, request, target) {
    var session = this,
      event_name = 'new_session';

    session.direction = originator;

    if (originator === 'remote') {
      session.local_identity = request.s('to').uri;
      session.remote_identity = request.s('from').uri;
    } else if (originator === 'local'){
      session.local_identity = session.ua.configuration.user;
      session.remote_identity = target;
    }

    session.ua.emit(event_name, session, {
      originator: originator,
      request: request
    });
  };

  Session.prototype.progress = function(response) {
    var session = this,
      event_name = 'session_progress';

    session.emit(event_name, session, {
      originator: 'remote',
      response: response
    });
  };

  Session.prototype.started = function(originator, message) {
    var session = this,
      event_name = 'session_started';

    session.start_time = new Date();

    session.emit(event_name, session, {
      response: message || null
    });
  };

  Session.prototype.ended = function(originator, message, cause) {
    var session = this,
      event_name = 'session_ended';

    session.end_time = new Date();

    session.close();
    session.emit(event_name, session, {
      originator: originator,
      message: message,
      cause: cause
    });
  };


  Session.prototype.failed = function(originator, response, cause) {
    var session = this,
      event_name = 'session_failed';

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
  Session.prototype.terminate = function() {
    switch(this.status) {
      // - UAC -
      case JsSIP.c.SESSION_NULL:
      case JsSIP.c.SESSION_INVITE_SENT:
      case JsSIP.c.SESSION_1XX_RECEIVED:
        this.cancel();
        break;
        // - UAS -
      case JsSIP.c.SESSION_WAITING_FOR_ANSWER:
        this.reject();
        break;
      case JsSIP.c.SESSION_WAITING_FOR_ACK:
      case JsSIP.c.SESSION_CONFIRMED:
        // Send Bye
        this.sendBye();

        this.ended('local', null, JsSIP.c.causes.BYE);
        break;
    }

    this.close();
  };

  /**
  * Send an in-dialog message.
  * @param {String} body message content
  * @param {String} [content_type='text/plain']
  * @param {Function} [onSuccess]
  * @param {Function} [onFailure]
  */
  Session.prototype.message = function(body, content_type, onSuccess, onFailure) {
    // Check Callbacks
    var request, request_sender;

    onSuccess = (JsSIP.utils.isFunction(onSuccess)) ? onSuccess : null;
    onFailure = (JsSIP.utils.isFunction(onFailure)) ? onFailure : null;
    content_type = content_type || 'text/plain';

    // Create Request
    request = this.dialog.createRequest(JsSIP.c.MESSAGE, {
      content_type: content_type
    });
    request.body = body;

    // Define receiveResponse logic
    function receiveResponse(response) {
      switch(true) {
        case /^2[0-9]{2}$/.test(response.status_code):
          console.log(JsSIP.c.LOG_INVITE_SESSION +'Positive response received to in-dialog Message.');
          if (onSuccess) {
            onSuccess();
          }
          break;
        case /^[3456][0-9]{2}$/.test(response.status_code):
          console.log(JsSIP.c.LOG_INVITE_SESSION +'Negative response received to in-dialog Message.');
          if (onFailure) {
            onFailure();
          }
          break;
      }
    }

    // Create InDialogRequestSender
    request_sender = new InDialogRequestSender(this, request, receiveResponse, onFailure);
    // Send the request
    request_sender.send();
  };


  /**
   * Initial Request Sender
   */

  /**
   * @private
   */
  var InitialRequestSender = function(session, ua, request, mediaType) {
    var
    self = this,
    label = null;

    this.request = request;

    function send() {
      var request_sender = new JsSIP.RequestSender(self, ua);

      self.receiveResponse = function(response) {
        switch(true) {
          case /^100$/.test(response.status_code):
            session.received_100 = true;
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

        // Proceed to cancelation if the user requested.
        if(session.isCanceled) {
          if(response.status_code >= 100 && response.status_code < 200) {
            self.request.cancel();
          } else if(response.status_code >= 200 && response.status_code < 299) {
            session.sendACK(request);
            session.sendBye();
            self.request.send();
          }
          // Process the response otherwhise.
        } else {
          session.receiveInitialRequestResponse(label, response);
        }
      };

      self.onRequestTimeout = function() {
        session.onRequestTimeout();
      };

      self.onTransportError = function() {
        session.onTransportError();
      };

      request_sender.send();
    }

    function onMediaSuccess() {
      if (session.status === JsSIP.c.SESSION_TERMINATED) {
        session.mediaSession.close();
        return;
      }

      // Set the body to the request and send it.
      request.body = session.mediaSession.peerConnection.localDescription.sdp;
      session.status = JsSIP.c.SESSION_INVITE_SENT;
      send();
    }

    function onMediaFailure(fail,e) {
      if (session.status !== JsSIP.c.SESSION_TERMINATED) {
        console.log(JsSIP.c.LOG_CLIENT_INVITE_SESSION +'Media Access denied');
        session.failed('local', null, JsSIP.c.causes.USER_DENIED_MEDIA_ACCESS);
      }
    }

    session.mediaSession.startCaller(mediaType, onMediaSuccess, onMediaFailure);
  };


  var InDialogRequestSender = function(session, request, onReceiveResponse, onFailure) {
    this.session = session;
    this.request = request;
    this.onReceiveResponse = onReceiveResponse;
    this.onFailure = onFailure;
    this.reatempt = false; // Due to a 491 response
    this.reatemptTimer = null;
  };

  InDialogRequestSender.prototype = {
    send: function() {
      var request_sender = new JsSIP.RequestSender(this, this.session.ua);

      this.receiveResponse = function(response) {
        var status_code = response.status_code;

        // RFC3261 14.1.
        // Terminate the dialog if a 408 or 481 is received from a re-Invite.
        if (status_code === '408' || status_code === '480') {
          this.session.ended('remote', null, JsSIP.c.causes.IN_DIALOG_408_480);
          this.session.onFailure(response);
          this.onReceiveResponse(response);
        } else if (status_code === '491' && response.method === JsSIP.c.INVITE) {
          if(!this.reatempt && this.session.status !== JsSIP.c.TERMINATED) {
            this.request.cseq.value = this.request.dialog.local_seqnum += 1;
            this.reatemptTimer = window.setTimeout(
              function() { request_sender.send(); },
              this.getReatempTimeout()
            );
          }
        } else {
          this.onReceiveResponse(response);
        }
      };

      this.onRequestTimeout = function() {
        this.session.onRequestTimeout();
        if (this.onFailure) {
          this.onFailure(JsSIP.c.REQUEST_TIMEOUT);
        }
      };

      this.onTransportError = function() {
        this.session.onTransportError();
        if (this.onFailure) {
          this.onFailure(JsSIP.c.causes.CONNECTION_ERROR);
        }
      };

      request_sender.send();
    },

    getReatempTimeout: function() { // RFC3261 14.1
      var timeout;

      if(this instanceof JsSIP.OutgoingSession) {
        timeout = (Math.random() * (4 - 2.1) + 2.1).toFixed(2);
      } else {
        timeout = (Math.random() * 2).toFixed(2);
      }

      return timeout;
    }
  };

  return Session;
}());
