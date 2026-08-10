import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  StripeTerminalProvider,
  useStripeTerminal
} from '@stripe/stripe-terminal-react-native';

/**
 * ALMA POS — native shell.
 *
 * The register itself stays the web app: one codebase, deploys in seconds,
 * no app-store round trip for a menu change. This shell exists for the one
 * thing a browser can't do — Tap to Pay on iPhone, which Apple restricts to
 * native apps holding the proximity-reader entitlement.
 *
 * The seam is deliberately narrow. The web POS posts a charge request; the
 * shell collects the card and posts the result back. Everything else — the
 * bill, the menu, printing, the floor plan — is untouched web code.
 */

const POS_URL = 'https://alma-pos.web.app';
// Set per charge by the web app, read by the SDK's token provider.
const latestConnectionToken = { current: '' };
const API_URL = 'https://api.almagroup.com.au';

type ChargeRequest = {
  type: 'ALMA_TAP_TO_PAY';
  amountCents: number;
  // The web app is the one holding the register's session, so IT calls the
  // API and passes down only what the reader needs. React Native's fetch
  // shares neither cookies nor the stored bearer token with the WebView, so
  // a shell that called the API itself would just get 401s.
  clientSecret: string;
  connectionToken: string;
};

// Injected into the page so the web POS knows it can offer Tap to Pay, and
// has a promise-shaped way to ask for it. Without this the web app behaves
// exactly as it does in Safari.
const BRIDGE = `
  (function () {
    if (window.almaNative) return;
    var pending = {};
    var seq = 0;
    window.almaNative = {
      platform: 'ios',
      tapToPay: true,
      charge: function (request) {
        return new Promise(function (resolve, reject) {
          var id = 'c' + (++seq);
          pending[id] = { resolve: resolve, reject: reject };
          window.ReactNativeWebView.postMessage(JSON.stringify(
            Object.assign({ type: 'ALMA_TAP_TO_PAY', id: id }, request)
          ));
        });
      },
      __resolve: function (id, payload) {
        var entry = pending[id];
        if (!entry) return;
        delete pending[id];
        if (payload && payload.ok) entry.resolve(payload);
        else entry.reject(new Error((payload && payload.error) || 'Payment failed'));
      }
    };
    window.dispatchEvent(new Event('alma-native-ready'));
  })();
  true;
`;

function Register() {
  const webRef = useRef<WebView>(null);
  const [status, setStatus] = useState<string | null>(null);
  const {
    initialize,
    discoverReaders,
    connectReader,
    createPaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    connectedReader
  } = useStripeTerminal();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Tap to Pay presents itself as a reader on this handset — discover and
  // connect once, then every charge is just collect + confirm.
  const ensureReader = useCallback(async () => {
    if (connectedReader) return;
    setStatus('Waking the card reader…');
    const { readers, error } = await discoverReaders({ discoveryMethod: 'tapToPay', simulated: false });
    if (error) throw new Error(error.message);
    const reader = readers?.[0];
    if (!reader) throw new Error('Tap to Pay is not available on this device.');
    const { error: connectError } = await connectReader({ reader }, 'tapToPay');
    if (connectError) throw new Error(connectError.message);
  }, [connectReader, connectedReader, discoverReaders]);

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let request: ChargeRequest & { id: string };
      try {
        request = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (request.type !== 'ALMA_TAP_TO_PAY') return;

      const reply = (payload: Record<string, unknown>) => {
        webRef.current?.injectJavaScript(
          `window.almaNative.__resolve(${JSON.stringify(request.id)}, ${JSON.stringify(payload)}); true;`
        );
        setStatus(null);
      };

      try {
        latestConnectionToken.current = request.connectionToken;
        await ensureReader();
        setStatus('Ask the guest to tap their card…');

        // The intent was created by the web app on the VENUE'S Stripe
        // account — St Alma and Alma Avalon are different companies and
        // their takings must never cross.
        const { paymentIntent, error: retrieveError } = await createPaymentIntent({
          clientSecret: request.clientSecret
        });
        if (retrieveError) throw new Error(retrieveError.message);

        const { paymentIntent: collected, error: collectError } = await collectPaymentMethod({
          paymentIntent: paymentIntent!
        });
        if (collectError) throw new Error(collectError.message);

        const { paymentIntent: confirmed, error: confirmError } = await confirmPaymentIntent({
          paymentIntent: collected!
        });
        if (confirmError) throw new Error(confirmError.message);

        reply({ ok: true, paymentIntentId: confirmed?.id, amountCents: request.amountCents });
      } catch (error) {
        reply({ ok: false, error: error instanceof Error ? error.message : 'Payment failed' });
      }
    },
    [collectPaymentMethod, confirmPaymentIntent, createPaymentIntent, ensureReader]
  );

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webRef}
        source={{ uri: POS_URL }}
        injectedJavaScriptBeforeContentLoaded={BRIDGE}
        onMessage={(event) => void onMessage(event)}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        originWhitelist={['https://*']}
        style={styles.web}
      />
      {status ? (
        <View style={styles.status}>
          <ActivityIndicator color="#F3EFE6" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function App() {
  // Stripe hands the SDK a short-lived token minted by our server, so no
  // secret key ever ships inside the app.
  // Handed in by the web app with each charge (it has the session); the SDK
  // asks for it whenever it needs to re-authenticate.
  const fetchTokenProvider = useCallback(async () => latestConnectionToken.current, []);

  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={fetchTokenProvider}>
      <Register />
    </StripeTerminalProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#1F3524' },
  web: { flex: 1 },
  status: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    backgroundColor: '#1F3524'
  },
  statusText: { color: '#F3EFE6', fontSize: 15, fontWeight: '600' }
});
