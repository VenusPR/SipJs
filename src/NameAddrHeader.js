/**
 * @augments JsSIP
 * @class Class creating a Name Address SIP header.
 *
 * @param {JsSIP.URI} uri
 * @param {String} [display_name]
 * @param {Object} [parameters]
 *
 */
JsSIP.NameAddrHeader = function(uri, display_name, parameters) {
  var param;

  // Checks
  if(!uri || !uri instanceof JsSIP.URI) {
    console.warn('Missing or invalid "uri" in NameAddrHeader');
    throw new JsSIP.exceptions.InvalidValueError();
  }

  // Initialize parameters
  this.uri = uri;
  this.parameters = {};

  for (param in parameters) {
    this.setParam(param, parameters[param]);
  }

  Object.defineProperties(this, {
    display_name: {
      get: function() { return display_name; },
      set: function(value) {
        display_name = value;
      }
    }
  });
};
JsSIP.NameAddrHeader.prototype = {
  setParam: function(key, value) {
    if (key) {
      this.parameters[key.toLowerCase()] = (typeof value === 'undefined' || value === null)? null : value.toString();
    }
  },

  getParam: function(key) {
    if(key) {
      return this.parameters[key.toLowerCase()];
    }
  },

  hasParam: function(key) {
    if(key) {
      return this.parameters.hasOwnProperty(key.toLowerCase()) && true || false;
    }
  },

  deleteParam: function(parameter) {
    parameter = parameter.toLowerCase();
    if (this.parameters.hasOwnProperty(parameter)) {
      delete this.parameters[parameter];
    }
  },

  clearParams: function() {
    this.parameters = {};
  },

  clone: function() {
    return new JsSIP.NameAddrHeader(
      this.uri.clone(),
      this.display_name,
      window.JSON.parse(window.JSON.stringify(this.parameters)));
  },

  toString: function() {
    var body, parameter;

    body  = (this.display_name) ? '"' + this.display_name + '" ' : '';
    body += (this.display_name) ? '<' + this.uri.toString() + '>' : this.uri.toString();


    for (parameter in this.parameters) {
      body += ';' + parameter;
      body += (this.parameters[parameter] === null)? '' : '=' + this.parameters[parameter];
    }
    return body;
  }
};