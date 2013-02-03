
/**
 * @fileoverview Registrator Agent
 */

/**
 * @augments JsSIP
 * @class Class creating a registrator agent.
 * @param {JsSIP.UA} ua
 * @param {JsSIP.Transport} transport
 */
JsSIP.Registrator = function(ua, transport) {
  var reg_id=1; //Force reg_id to 1.

  this.ua = ua;
  this.transport = transport;

  this.expires = ua.configuration.register_expires;
  this.min_expires = ua.configuration.register_min_expires;

  // Call-ID and CSeq values RFC3261 10.2
  this.call_id = Math.random().toString(36).substr(2, 22);
  this.cseq = 80;

  this.registrar = 'sip:'+ ua.configuration.domain;
  // this.to_uri
  this.from_uri = ua.configuration.from_uri;

  this.registrationTimer = null;

  // Set status
  this.registered = this.registered_before = false;

  // Save into ua instance
  this.ua.registrator = this;

  // Contact header
  if(reg_id) {
    this.contact = '<' + this.ua.contact.uri + '>';
    this.contact += ';reg-id='+ reg_id;
    this.contact += ';+sip.instance="<urn:uuid:'+ this.ua.configuration.instance_id+'>"';
  } else {
    this.contact = '<' + this.ua.contact.uri + '>';
  }

  this.register();
};

JsSIP.Registrator.prototype = {
  /**
   * @param {Object} [options]
   */
  register: function(options) {
    var request_sender, cause, extraHeaders,
      self = this;

    options = options || {};
    extraHeaders = options.extraHeaders || [];
    extraHeaders.push('Contact: '+ this.contact + ';expires=' + this.expires);
    extraHeaders.push('Allow: '+ JsSIP.Utils.getAllowedMethods(this.ua));

    this.request = new JsSIP.OutgoingRequest(JsSIP.C.REGISTER, this.registrar, this.ua, {
        'to_uri': this.from_uri,
        'call_id': this.call_id,
        'cseq': (this.cseq += 1)
      }, extraHeaders);

    request_sender = new JsSIP.RequestSender(this, this.ua);

    /**
    * @private
    */
    this.receiveResponse = function(response) {
      var contact, expires, min_expires,
        contacts = response.countHeader('contact');

      // Discard responses to older Register/Unregister requests.
      if(response.cseq !== this.cseq) {
        return;
      }

      switch(true) {
        case /^1[0-9]{2}$/.test(response.status_code):
          // Ignore provisional responses.
          break;
        case /^2[0-9]{2}$/.test(response.status_code):
          if(response.hasHeader('expires')) {
            expires = response.getHeader('expires');
          }

          // Search the contact pointing to us and update the expires value
          //accordingly
          if (!contacts) {
            console.log(JsSIP.C.LOG_REGISTRATOR +'No Contact header positive response to Register. Ignore response');
            break;
          }

          while(contacts--) {
            contact = response.parseHeader('contact', contacts);
            if(contact.uri === this.ua.contact.uri) {
              expires = contact.getParam('expires');
              break;
            }
          }

          if (!contact) {
            console.log(JsSIP.C.LOG_REGISTRATOR +'No Contact header pointing to us. Ignore response');
            break;
          }

          if(!expires) {
            expires = this.expires;
          }

          // Re-Register before the expiration interval has elapsed.
          // For that, decrease the expires value. ie: 3 seconds
          this.registrationTimer = window.setTimeout(function() {
            self.register();
          }, (expires * 1000) - 3000);

          //Save gruu values
          if (contact.hasParam('temp-gruu')) {
            this.ua.contact.temp_gruu = contact.getParam('temp-gruu').replace(/"/g,'');
          }
          if (contact.hasParam('pub-gruu')) {
            this.ua.contact.pub_gruu = contact.getParam('pub-gruu').replace(/"/g,'');
          }

          this.registered = true;
          this.ua.emit('registered', this.ua, {
            response: response
          });
          break;
        // Interval too brief RFC3261 10.2.8
        case /^423$/.test(response.status_code):
          if(response.hasHeader('min-expires')) {
            min_expires = response.getHeader('min-expires');
            expires = (min_expires - this.expires);
            this.registrationTimer = window.setTimeout(function() {
              self.register();
            }, this.expires * 1000);
          } else { //This response MUST contain a Min-Expires header field
          console.log(JsSIP.C.LOG_REGISTRATOR +'423 response code received to a REGISTER without min-expires. Unregister');
          this.registrationFailure(response, JsSIP.C.causes.SIP_FAILURE_CODE);
          }
          break;
        default:
          cause = JsSIP.Utils.sipErrorCause(response.status_code);
          this.registrationFailure(response, cause);
      }
    };

    /**
    * @private
    */
    this.onRequestTimeout = function() {
      this.registrationFailure(null, JsSIP.C.causes.REQUEST_TIMEOUT);
    };

    /**
    * @private
    */
    this.onTransportError = function() {
      this.registrationFailure(null, JsSIP.C.causes.CONNECTION_ERROR);
    };

    request_sender.send();
  },

  /**
  * @param {Object} [options]
  */
  unregister: function(options) {
    var extraHeaders;

    if(!this.registered) {
      console.log(JsSIP.C.LOG_REGISTRATOR +"Already unregistered");
      return;
    }

    options = options || {};
    extraHeaders = options.extraHeaders || [];

    this.registered = false;

    // Clear the registration timer.
    window.clearTimeout(this.registrationTimer);

    if(options.all) {
      extraHeaders.push('Contact: *');
      extraHeaders.push('Expires: 0');

      this.request = new JsSIP.OutgoingRequest(JsSIP.C.REGISTER, this.registrar, this.ua, {
          'to_uri': this.from_uri,
          'call_id': this.call_id,
          'cseq': (this.cseq += 1)
        }, extraHeaders);
    } else {
      extraHeaders.push('Contact: '+ this.contact + ';expires=0');

      this.request = new JsSIP.OutgoingRequest(JsSIP.C.REGISTER, this.registrar, this.ua, {
          'to_uri': this.from_uri,
          'call_id': this.call_id,
          'cseq': (this.cseq += 1)
        }, extraHeaders);
    }

    var request_sender = new JsSIP.RequestSender(this, this.ua);

    /**
    * @private
    */
    this.receiveResponse = function(response) {
      var cause;

      switch(true) {
        case /^1[0-9]{2}$/.test(response.status_code):
          // Ignore provisional responses.
          break;
        case /^2[0-9]{2}$/.test(response.status_code):
          this.unregistered(response);
          break;
        default:
          cause = JsSIP.Utils.sipErrorCause(response.status_code);
          this.unregistered(response, cause);
      }
    };

    /**
    * @private
    */
    this.onRequestTimeout = function() {
      this.unregistered(null, JsSIP.C.causes.REQUEST_TIMEOUT);
    };

    /**
    * @private
    */
    this.onTransportError = function() {
      this.unregistered(null, JsSIP.C.causes.CONNECTION_ERROR);
    };

    request_sender.send();
  },

  /**
  * @private
  */
  registrationFailure: function(response, cause) {
    this.ua.emit('registrationFailed', this.ua, {
      response: response || null,
      cause: cause
    });

    if (this.registered) {
      this.registered = false;
      this.ua.emit('unregistered', this.ua, {
        response: response || null,
        cause: cause
      });
    }
  },

  /**
   * @private
   */
  unregistered: function(response, cause) {
    this.registered = false;
    this.ua.emit('unregistered', this.ua, {
      response: response || null,
      cause: cause || null
    });
  },

  /**
  * @private
  */
  onTransportClosed: function() {
    this.registered_before = this.registered;
    window.clearTimeout(this.registrationTimer);

    if(this.registered) {
      this.registered = false;
      this.ua.emit('unregistered', this.ua);
    }
  },

  /**
  * @private
  */
  onTransportConnected: function() {
    this.register();
  },

  /**
  * @private
  */
  close: function() {
    this.registered_before = this.registered;
    this.unregister();
  }
};
