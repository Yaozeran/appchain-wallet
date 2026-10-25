import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCheckoutUrl } from '../src/lib/moonpay.ts';

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const query = `?currencyCode=eth&walletAddress=${address}&signature=fixture%2Bsignature%3D`;

test('accepts only the expected sandbox or live MoonPay checkout for this wallet', () => {
  assert.equal(validateCheckoutUrl(`https://buy-sandbox.moonpay.com${query}`, address, 'sandbox'), `https://buy-sandbox.moonpay.com/${query}`);
  assert.equal(validateCheckoutUrl(`https://buy.moonpay.com${query}`, address, 'production'), `https://buy.moonpay.com/${query}`);
});

test('rejects injected redirects, wrong networks, recipients, and unsigned URLs', () => {
  for (const url of [
    `https://attacker.test${query}`,
    `https://buy.moonpay.com${query}`,
    `http://buy-sandbox.moonpay.com${query}`,
    `https://buy-sandbox.moonpay.com.attacker.test${query}`,
    `https://attacker@buy-sandbox.moonpay.com${query}`,
    `https://buy-sandbox.moonpay.com:444${query}`,
    `https://buy-sandbox.moonpay.com/other${query}`,
    `https://buy-sandbox.moonpay.com${query}#fragment`,
    `https://buy-sandbox.moonpay.com${query.replace('currencyCode=eth', 'currencyCode=btc')}`,
    `https://buy-sandbox.moonpay.com${query.replace(address, '0x' + '1'.repeat(40))}`,
    `https://buy-sandbox.moonpay.com${query}&walletAddress=${address}`,
    `https://buy-sandbox.moonpay.com${query}&currencyCode=btc`,
    `https://buy-sandbox.moonpay.com?currencyCode=eth&walletAddress=${address}`,
    'javascript:alert(1)',
    null,
  ]) assert.throws(() => validateCheckoutUrl(url, address, 'sandbox'));
});
