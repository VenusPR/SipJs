const JsSIP_C = require('./Constants');
const Utils = require('./Utils');
const Grammar = require('./Grammar');

/**
 * -param {String} [scheme]
 * -param {String} [user]
 * -param {String} host
 * -param {String} [port]
 * -param {Object} [parameters]
 * -param {Object} [headers]
 *
 */
module.exports = class URI
{
  /**
    * Parse the given string and returns a JsSIP.URI instance or undefined if
    * it is an invalid URI.
    */
  static parse(uri)
  {
    uri = Grammar.parse(uri, 'SIP_URI');

    if (uri !== -1)
    {
      return uri;
    }
    else
    {
      return undefined;
    }
  }

  constructor(scheme, user, host, port, parameters = {}, headers = {})
  {
    // Checks
    if (!host)
    {
      throw new TypeError('missing or invalid "host" parameter');
    }

    // Initialize parameters
    scheme = scheme || JsSIP_C.SIP;
    this.parameters = {};
    this.headers = {};

    for (const param in parameters)
    {
      if (Object.prototype.hasOwnProperty.call(parameters, param))
      {
        this.setParam(param, parameters[param]);
      }
    }

    for (const header in headers)
    {
      if (Object.prototype.hasOwnProperty.call(headers, header))
      {
        this.setHeader(header, headers[header]);
      }
    }

    Object.defineProperties(this, {
      scheme : {
        get() { return scheme; },
        set(value)
        {
          scheme = value.toLowerCase();
        }
      },

      user : {
        get() { return user; },
        set(value)
        {
          user = value;
        }
      },

      host : {
        get() { return host; },
        set(value)
        {
          host = value.toLowerCase();
        }
      },

      port : {
        get() { return port; },
        set(value)
        {
          port = value === 0 ? value : (parseInt(value, 10) || null);
        }
      }
    });
  }

  setParam(key, value)
  {
    if (key)
    {
      this.parameters[key.toLowerCase()] = (typeof value === 'undefined' || value === null) ? null : value.toString();
    }
  }

  getParam(key)
  {
    if (key)
    {
      return this.parameters[key.toLowerCase()];
    }
  }

  hasParam(key)
  {
    if (key)
    {
      return (this.parameters.hasOwnProperty(key.toLowerCase()) && true) || false;
    }
  }

  deleteParam(parameter)
  {
    parameter = parameter.toLowerCase();
    if (this.parameters.hasOwnProperty(parameter))
    {
      const value = this.parameters[parameter];

      delete this.parameters[parameter];

      return value;
    }
  }

  clearParams()
  {
    this.parameters = {};
  }

  setHeader(name, value)
  {
    this.headers[Utils.headerize(name)] = (Array.isArray(value)) ? value : [ value ];
  }

  getHeader(name)
  {
    if (name)
    {
      return this.headers[Utils.headerize(name)];
    }
  }

  hasHeader(name)
  {
    if (name)
    {
      return (this.headers.hasOwnProperty(Utils.headerize(name)) && true) || false;
    }
  }

  deleteHeader(header)
  {
    header = Utils.headerize(header);
    if (this.headers.hasOwnProperty(header))
    {
      const value = this.headers[header];

      delete this.headers[header];

      return value;
    }
  }

  clearHeaders()
  {
    this.headers = {};
  }

  clone()
  {
    return new URI(
      this.scheme,
      this.user,
      this.host,
      this.port,
      JSON.parse(JSON.stringify(this.parameters)),
      JSON.parse(JSON.stringify(this.headers)));
  }

  toString()
  {
    const headers = [];

    let uri = `${this.scheme}:`;

    if (this.user)
    {
      uri += `${Utils.escapeUser(this.user)}@`;
    }
    uri += this.host;
    if (this.port || this.port === 0)
    {
      uri += `:${this.port}`;
    }

    for (const parameter in this.parameters)
    {
      if (Object.prototype.hasOwnProperty.call(this.parameters, parameter))
      {
        uri += `;${parameter}`;

        if (this.parameters[parameter] !== null)
        {
          uri += `=${this.parameters[parameter]}`;
        }
      }
    }

    for (const header in this.headers)
    {
      if (Object.prototype.hasOwnProperty.call(this.headers, header))
      {
        for (const item of this.headers[header])
        {
          headers.push(`${header}=${item}`);
        }
      }
    }

    if (headers.length > 0)
    {
      uri += `?${headers.join('&')}`;
    }

    return uri;
  }

  toAor(show_port)
  {
    let aor = `${this.scheme}:`;

    if (this.user)
    {
      aor += `${Utils.escapeUser(this.user)}@`;
    }
    aor += this.host;
    if (show_port && (this.port || this.port === 0))
    {
      aor += `:${this.port}`;
    }

    return aor;
  }
};
