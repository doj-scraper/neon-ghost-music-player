# Debug Notes

## Production Preview Console Output

```
Failed to load resource: the server responded with a status of 404 (Not Found)
ReferenceError: Cannot access 'Je' before initialization
    at QE (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:236:31980)
    at JE (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:236:57013)
    at tu (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:48086)
    at wu (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:70888)
    at yp (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:81221)
    at Zp (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:116991)
    at Ny (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:116037)
    at Xu (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:115869)
    at qp (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:112662)
    at s0 (http://127.0.0.1:4173/assets/index-Bo93ckAk.js:49:124462)
```

## Source Map Lookup

Mapped `index-Bo93ckAk.js:236:31980` to:

```
client/src/hooks/useAudioEngine.ts:722:6 (setPlayback)
```

## Root Cause Hypothesis

`setPlayback` was referenced in a `useEffect` dependency array before it was initialized in `useAudioEngine`, triggering a TDZ `ReferenceError` in production bundles.
