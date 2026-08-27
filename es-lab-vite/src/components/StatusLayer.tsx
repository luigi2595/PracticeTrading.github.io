// The toast pill and the screen-reader-only live-region announcer. Ported
// from toast()/announce() in part3.js and the #toast/#announcer markup in
// part2.html. The reducer only ever bumps state.toast/state.announcement's
// `id` and sets `text` (see withToast/withAnnounce in reducer.ts) — this
// component owns the actual show/hide timing, matching the originals'
// classList-toggle-plus-setTimeout and clear-then-set-after-40ms patterns.
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreContext';

export default function StatusLayer() {
  const { state } = useStore();
  const [toastText, setToastText] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.toast) return;
    setToastText(state.toast.text);
    setToastShow(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setToastShow(false), 2200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.toast?.id]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const [announceText, setAnnounceText] = useState('');
  useEffect(() => {
    if (!state.announcement) return;
    setAnnounceText('');
    const msg = state.announcement.text;
    const id = window.setTimeout(() => setAnnounceText(msg), 40);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.announcement?.id]);

  return (
    <>
      <div className={'toast' + (toastShow ? ' show' : '')} id="toast">{toastText}</div>
      <div id="announcer" className="sr" role="status" aria-live="polite" aria-atomic="true">{announceText}</div>
    </>
  );
}
