/** The browser privacy signals we honour. `globalPrivacyControl` is not in the DOM lib yet. */
export interface PrivacySignals {
  readonly doNotTrack?: string | null;
  readonly globalPrivacyControl?: boolean;
}

/** False when Do-Not-Track ("1"/"yes", navigator or legacy window) or Global Privacy Control is set. */
export function trackingAllowed(nav: PrivacySignals | undefined, win?: { readonly doNotTrack?: string | null }): boolean {
  if (!nav || nav.globalPrivacyControl === true) return false;
  const dnt = nav.doNotTrack ?? win?.doNotTrack;
  return dnt !== '1' && dnt !== 'yes';
}
