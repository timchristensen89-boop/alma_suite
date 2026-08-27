// Everything Tap to Pay needs is opt-in, and for two different reasons.
//
// The ENTITLEMENT is opt-in because requesting it before Apple grants it makes
// code signing fail.
//
// The PERMISSIONS and the Stripe plugin are opt-in because of App Review. The
// shell ships without payments on purpose — Square Terminals handle cards, and
// the playbook's whole argument is that a reviewer should see a business tool
// rather than a payment app. A build with no payment feature that still asks
// for location ("Stripe requires your location to accept card payments") and
// Bluetooth ("Connect to a Stripe card reader") contradicts that argument in
// the reviewer's own permission dialogs, and Guideline 5.1.1 is explicit that
// an app should not request data it does not use.
//
// So: build normally and none of it is present. Build with ALMA_TAP_TO_PAY=1,
// once the entitlement lands and the SDK has moved to Square, and the
// entitlement, the plugin and the purpose strings all arrive together.
const base = require('./app.json');

const STRIPE_TERMINAL_PLUGIN = [
  '@stripe/stripe-terminal-react-native',
  {
    bluetoothBackgroundMode: false,
    locationWhenInUsePermission: 'Stripe requires your location to accept card payments on this device.',
    bluetoothPeripheralPermission: 'Connect to a Stripe card reader.',
    bluetoothAlwaysUsagePermission: 'Connect to a Stripe card reader.'
  }
];

module.exports = () => {
  const config = JSON.parse(JSON.stringify(base)).expo;

  if (process.env.ALMA_TAP_TO_PAY === '1') {
    config.ios.entitlements = {
      ...(config.ios.entitlements ?? {}),
      'com.apple.developer.proximity-reader.payment.acceptance': true
    };
    config.ios.infoPlist = {
      ...(config.ios.infoPlist ?? {}),
      NSLocationWhenInUseUsageDescription:
        'Stripe requires your location to accept card payments on this device.'
    };
    config.plugins = [...(config.plugins ?? []), STRIPE_TERMINAL_PLUGIN];
  }

  return config;
};
