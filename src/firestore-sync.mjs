/**
 * Optional shared-sync layer for The Barn.
 *
 * When this module loads successfully, Firestore becomes the source of
 * truth for {items, events, history, settings} — every device that opens
 * the app converges on the same live inventory. `draft` (an in-progress,
 * unsaved count) is deliberately NOT synced here; it stays purely local so
 * one device's half-finished count can never be overwritten by another
 * device's activity. See src/storage.mjs for the local cache/fallback layer
 * this sits on top of, and app.js for how the two are combined.
 *
 * The Firebase web API key below is not a secret — it only identifies the
 * project. Actual access control lives in firestore.rules, deployed
 * separately, which exposes only the /barn/** document path used here.
 */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAIwFNDgMbQswNvClB6LpmmFONcX1_DRes',
  authDomain: 'the-barn-inventory-2efc7.firebaseapp.com',
  projectId: 'the-barn-inventory-2efc7',
  storageBucket: 'the-barn-inventory-2efc7.firebasestorage.app',
  messagingSenderId: '972584088348',
  appId: '1:972584088348:web:2e72e54d797ef00893c0d9',
};

const SDK_VERSION = '10.13.1';
const DOC_PATH = ['barn', 'state'];

let modulePromise = null;

/** Lazily loads the Firebase SDK from a CDN — no bundler, no npm dependency. */
function loadSdk() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const [{ initializeApp }, firestore] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
      ]);
      const app = initializeApp(FIREBASE_CONFIG);
      const db = firestore.getFirestore(app);
      return { db, firestore };
    })();
  }
  return modulePromise;
}

/**
 * Subscribes to the shared document. `onChange(data, meta)` fires once with
 * the current value (or `null` if nothing has ever been shared yet) and
 * again on every future change from any device, including this one's own
 * writes as they're confirmed. Returns an unsubscribe function.
 */
export async function subscribeShared(onChange, onError) {
  const { db, firestore } = await loadSdk();
  const ref = firestore.doc(db, ...DOC_PATH);
  return firestore.onSnapshot(
    ref,
    snap => onChange(snap.exists() ? snap.data() : null, {
      hasPendingWrites: snap.metadata.hasPendingWrites,
      fromCache: snap.metadata.fromCache,
    }),
    error => onError?.(error),
  );
}

/** Overwrites the shared document with the given plain-object state. */
export async function writeShared(value) {
  const { db, firestore } = await loadSdk();
  const ref = firestore.doc(db, ...DOC_PATH);
  await firestore.setDoc(ref, value);
}
