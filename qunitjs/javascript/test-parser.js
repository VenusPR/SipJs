test('Parse URI', function() {
  var data = 'SIP:%61liCE@versaTICA.Com:6060;TRansport=TCp;Foo=123;baz?X-Header-1=AaA1&X-Header-2=BbB&x-header-1=AAA2';
  var uri = JsSIP.Utils.parseURI(data);

  // Parsed data.
  ok(uri instanceof(JsSIP.URI));
  strictEqual(uri.scheme, 'sip');
  strictEqual(uri.user, 'aliCE');
  strictEqual(uri.host, 'versatica.com');
  strictEqual(uri.port, 6060);
  strictEqual(uri.hasParam('transport'), true);
  strictEqual(uri.hasParam('nooo'), false);
  strictEqual(uri.getParam('transport'), 'tcp');
  strictEqual(uri.getParam('foo'), '123');
  strictEqual(uri.getParam('baz'), null);
  strictEqual(uri.getParam('nooo'), undefined);
  deepEqual(uri.getHeader('x-header-1'), ['AaA1', 'AAA2']);
  deepEqual(uri.getHeader('X-HEADER-2'), ['BbB']);
  strictEqual(uri.getHeader('nooo'), undefined);
  strictEqual(uri.toString(), 'sip:aliCE@versatica.com:6060;transport=tcp;foo=123;baz?X-Header-1=AaA1&X-Header-1=AAA2&X-Header-2=BbB');
  strictEqual(uri.toAor(), 'sip:aliCE@versatica.com');

  // Alter data.
  uri.user = 'Iñaki:PASSWD';
  strictEqual(uri.user, 'Iñaki:PASSWD');
  strictEqual(uri.deleteParam('foo'), '123');
  deepEqual(uri.deleteHeader('x-header-1'), ['AaA1', 'AAA2']);
  strictEqual(uri.toString(), 'sip:I%C3%B1aki:PASSWD@versatica.com:6060;transport=tcp;baz?X-Header-2=BbB');
  strictEqual(uri.toAor(), 'sip:I%C3%B1aki:PASSWD@versatica.com');
  uri.clearParams();
  uri.clearHeaders();
  uri.port = null;
  strictEqual(uri.toString(), 'sip:I%C3%B1aki:PASSWD@versatica.com');
  strictEqual(uri.toAor(), 'sip:I%C3%B1aki:PASSWD@versatica.com');
});


test('Parse multiple Contact', function() {
  var data = '"Iñaki @ł€" <SIP:+1234@ALIAX.net;Transport=WS>;+sip.Instance="abCD", sip:bob@biloxi.COM;headerParam, <sip:DOMAIN.com:5>';
  var contacts = JsSIP.Grammar.parse(data, 'Contact');

  ok(contacts instanceof(Array));
  strictEqual(contacts.length, 3);
  var c1 = contacts[0].parsed;
  var c2 = contacts[1].parsed;
  var c3 = contacts[2].parsed;

  // Parsed data.
  ok(c1 instanceof(JsSIP.NameAddrHeader));
  strictEqual(c1.display_name, 'Iñaki @ł€');
  strictEqual(c1.hasParam('+sip.instance'), true);
  strictEqual(c1.hasParam('nooo'), false);
  strictEqual(c1.getParam('+SIP.instance'), '"abcd"');
  strictEqual(c1.getParam('nooo'), undefined);
  ok(c1.uri instanceof(JsSIP.URI));
  strictEqual(c1.uri.scheme, 'sip');
  strictEqual(c1.uri.user, '+1234');
  strictEqual(c1.uri.host, 'aliax.net');
  strictEqual(c1.uri.port, undefined);
  strictEqual(c1.uri.getParam('transport'), 'ws');
  strictEqual(c1.uri.getParam('foo'), undefined);
  strictEqual(c1.uri.getHeader('X-Header'), undefined);
  strictEqual(c1.toString(), '"Iñaki @ł€" <sip:+1234@aliax.net;transport=ws>;+sip.instance="abcd"');

  // Alter data.
  c1.display_name = '€€€';
  strictEqual(c1.display_name, '€€€');
  c1.uri.user = '+999';
  strictEqual(c1.uri.user, '+999');
  c1.setParam('+sip.instance', '"zxCV"');
  strictEqual(c1.getParam('+SIP.instance'), '"zxcv"');
  c1.setParam('New-Param', null);
  strictEqual(c1.hasParam('NEW-param'), true);
  c1.uri.setParam('New-Param', null);
  strictEqual(c1.toString(), '"€€€" <sip:+999@aliax.net;transport=ws;new-param>;+sip.instance="zxcv";new-param');

  // Parsed data.
  ok(c2 instanceof(JsSIP.NameAddrHeader));
  strictEqual(c2.display_name, undefined);
  strictEqual(c2.hasParam('HEADERPARAM'), true);
  ok(c2.uri instanceof(JsSIP.URI));
  strictEqual(c2.uri.scheme, 'sip');
  strictEqual(c2.uri.user, 'bob');
  strictEqual(c2.uri.host, 'biloxi.com');
  strictEqual(c2.uri.port, undefined);
  strictEqual(c2.uri.hasParam('headerParam'), false);
  strictEqual(c2.toString(), '<sip:bob@biloxi.com>;headerparam');

  // Alter data.
  c2.display_name = '@ł€ĸłæß';
  strictEqual(c2.toString(), '"@ł€ĸłæß" <sip:bob@biloxi.com>;headerparam');

  // Parsed data.
  ok(c3 instanceof(JsSIP.NameAddrHeader));
  strictEqual(c3.display_name, undefined);
  ok(c3.uri instanceof(JsSIP.URI));
  strictEqual(c3.uri.scheme, 'sip');
  strictEqual(c3.uri.user, undefined);
  strictEqual(c3.uri.host, 'domain.com');
  strictEqual(c3.uri.port, 5);
  strictEqual(c3.uri.hasParam('nooo'), false);
  strictEqual(c3.toString(), '<sip:domain.com:5>');

  // Alter data.
  c3.uri.setParam('newUriParam', 'zxCV');
  c3.setParam('newHeaderParam', 'zxCV');
  strictEqual(c3.toString(), '<sip:domain.com:5;newuriparam=zxcv>;newheaderparam=zxcv');
});


test('Parse Via', function() {
  var data = 'SIP /  3.0 \r\n / UDP [1:ab::FF]:6060 ;\r\n  BRanch=1234;Param1=Foo;paRAM2;param3=Bar';
  var via = JsSIP.Grammar.parse(data, 'Via');

  strictEqual(via.protocol, 'SIP');
  strictEqual(via.transport, 'UDP');
  strictEqual(via.host, '[1:ab::FF]');
  strictEqual(via.host_type, 'IPv6');
  strictEqual(via.port, 6060);
  strictEqual(via.branch, '1234');
  deepEqual(via.params, {param1: 'foo', param2: undefined, param3: 'bar'});
});


test('Parse CSeq', function() {
  var data = '123456  CHICKEN';
  var cseq = JsSIP.Grammar.parse(data, 'CSeq');

  strictEqual(cseq.value, 123456);
  strictEqual(cseq.method, 'CHICKEN');
});
