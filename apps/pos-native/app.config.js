// Tap to Pay needs Apple's proximity-reader entitlement. Requesting it before
// Apple grants it makes code signing fail, so it's opt-in: once the grant
// lands, build with ALMA_TAP_TO_PAY=1 and it's included.
const base = require('./app.json');

module.exports = () => {
  const config = JSON.parse(JSON.stringify(base)).expo;
  if (process.env.ALMA_TAP_TO_PAY === '1') {
    config.ios.entitlements = {
      ...(config.ios.entitlements ?? {}),
      'com.apple.developer.proximity-reader.payment.acceptance': true
    };
  }
  return config;
};
