const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeOrigin,
  isCertErrorCode,
  allowCertException,
  isCertExceptionAllowed,
  listCertExceptions,
  clearCertExceptions
} = require('../src/main/cert-exceptions');

test('CERT-1: cert exceptions are exact-origin, https-only, session-only', () => {
  clearCertExceptions();
  assert.equal(normalizeOrigin('https://example.com:8443/path'), 'https://example.com:8443');
  assert.equal(normalizeOrigin('http://example.com/'), '');
  assert.equal(normalizeOrigin('not a url'), '');
  assert.equal(allowCertException('https://example.com/'), 'https://example.com');
  assert.equal(isCertExceptionAllowed('https://example.com/other'), true);
  assert.equal(isCertExceptionAllowed('https://sub.example.com/'), false, 'no suffix matching');
  assert.equal(isCertExceptionAllowed('https://example.com.evil.com/'), false);
  assert.equal(isCertExceptionAllowed('http://example.com/'), false);
  assert.deepEqual(listCertExceptions(), ['https://example.com']);
  clearCertExceptions();
  assert.equal(isCertExceptionAllowed('https://example.com/'), false, 'cleared on quit');
  assert.deepEqual(listCertExceptions(), []);
});

test('CERT-2: cert error codes are recognised, other errors are not', () => {
  assert.equal(isCertErrorCode(-201, 'ERR_CERT_AUTHORITY_INVALID'), true);
  assert.equal(isCertErrorCode(-202, 'ERR_CERT_DATE_INVALID'), true);
  assert.equal(isCertErrorCode(-200, 'ERR_CERT_COMMON_NAME_INVALID'), true);
  assert.equal(isCertErrorCode(-219, 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM'), true);
  assert.equal(isCertErrorCode(-105, 'ERR_NAME_NOT_RESOLVED'), false);
  assert.equal(isCertErrorCode(-101, 'ERR_CONNECTION_RESET'), false);
  assert.equal(isCertErrorCode('', 'ERR_FAILED'), false);
});
