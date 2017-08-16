'use strict';

/**
 * Dependencies.
 */
const debug = require('debug')('JsSIP:RequestSender');
const JsSIP_C = require('./Constants');
const UA_C = require('./UA_Constants');
const DigestAuthentication = require('./DigestAuthentication');
const Transactions = require('./Transactions');


class RequestSender {
  constructor(applicant, ua) {
    this.ua = ua;
    this.applicant = applicant;
    this.method = applicant.request.method;
    this.request = applicant.request;
    this.auth = null;
    this.challenged = false;
    this.staled = false;

    // If ua is in closing process or even closed just allow sending Bye and ACK
    if (ua.status === UA_C.STATUS_USER_CLOSED && (this.method !== JsSIP_C.BYE || this.method !== JsSIP_C.ACK)) {
      this.onTransportError();
    }
  }

  /**
  * Create the client transaction and send the message.
  */
  send() {
    switch(this.method) {
      case 'INVITE':
        this.clientTransaction = new Transactions.InviteClientTransaction(this, this.request, this.ua.transport);
        break;
      case 'ACK':
        this.clientTransaction = new Transactions.AckClientTransaction(this, this.request, this.ua.transport);
        break;
      default:
        this.clientTransaction = new Transactions.NonInviteClientTransaction(this, this.request, this.ua.transport);
    }

    this.clientTransaction.send();
  }

  /**
  * Callback fired when receiving a request timeout error from the client transaction.
  * To be re-defined by the applicant.
  */
  onRequestTimeout() {
    this.applicant.onRequestTimeout();
  }

  /**
  * Callback fired when receiving a transport error from the client transaction.
  * To be re-defined by the applicant.
  */
  onTransportError() {
    this.applicant.onTransportError();
  }

  /**
  * Called from client transaction when receiving a correct response to the request.
  * Authenticate request if needed or pass the response back to the applicant.
  */
  receiveResponse(response) {
    let challenge;
    let authorization_header_name;
    const status_code = response.status_code;

    /*
    * Authentication
    * Authenticate once. _challenged_ flag used to avoid infinite authentications.
    */
    if ((status_code === 401 || status_code === 407) &&
        (this.ua.configuration.password !== null || this.ua.configuration.ha1 !== null)) {

      // Get and parse the appropriate WWW-Authenticate or Proxy-Authenticate header.
      if (response.status_code === 401) {
        challenge = response.parseHeader('www-authenticate');
        authorization_header_name = 'authorization';
      } else {
        challenge = response.parseHeader('proxy-authenticate');
        authorization_header_name = 'proxy-authorization';
      }

      // Verify it seems a valid challenge.
      if (!challenge) {
        debug(`${response.status_code} with wrong or missing challenge, cannot authenticate`);
        this.applicant.receiveResponse(response);
        return;
      }

      if (!this.challenged || (!this.staled && challenge.stale === true)) {
        if (!this.auth) {
          this.auth = new DigestAuthentication({
            username : this.ua.configuration.authorization_user,
            password : this.ua.configuration.password,
            realm    : this.ua.configuration.realm,
            ha1      : this.ua.configuration.ha1
          });
        }

        // Verify that the challenge is really valid.
        if (!this.auth.authenticate(this.request, challenge)) {
          this.applicant.receiveResponse(response);
          return;
        }
        this.challenged = true;

        // Update ha1 and realm in the UA.
        this.ua.set('realm', this.auth.get('realm'));
        this.ua.set('ha1', this.auth.get('ha1'));

        if (challenge.stale) {
          this.staled = true;
        }

        let cseq;

        if (response.method === JsSIP_C.REGISTER) {
          cseq = this.applicant.cseq += 1;
        } else if (this.request.dialog) {
          cseq = this.request.dialog.local_seqnum += 1;
        } else {
          cseq = this.request.cseq + 1;
        }

        this.request = this.applicant.request = this.request.clone();

        this.request.cseq = cseq;
        this.request.setHeader('cseq', `${cseq} ${this.method}`);

        this.request.setHeader(authorization_header_name, this.auth.toString());
        this.send();
      } else {
        this.applicant.receiveResponse(response);
      }
    } else {
      this.applicant.receiveResponse(response);
    }
  }
}

module.exports = RequestSender;
