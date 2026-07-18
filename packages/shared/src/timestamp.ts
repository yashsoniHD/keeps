// Structural stand-in for a Firestore Timestamp so these types work against both the
// web SDK (`firebase/firestore`) and the native SDK (`@react-native-firebase/firestore`)
// without importing either.
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}
