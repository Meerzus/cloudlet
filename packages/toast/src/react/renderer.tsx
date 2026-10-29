import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { getRendererBridge } from '../core/bridge.js';
import type { HostLease } from '../contracts/internal.js';
import type { ReactCloudletController, ToasterProps } from '../react.js';
import { Host } from './host.js';

// The renderer chunk: Toaster in bindings.tsx loads this module on the client once, after mount.
const subscribeMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

interface Attachment {
  readonly controller: ReactCloudletController;
  readonly lease: HostLease;
  readonly container: Element;
  readonly document: Document;
}

export function AttachedToaster({ controller, options }: { controller: ReactCloudletController; options: ToasterProps }): ReactElement | null {
  // React supplies the server value during hydration, then the client value.
  // The inert marker can therefore identify the owner document without a store
  // or effect whose only purpose is an extra mounting render.
  const mounted = useSyncExternalStore(subscribeMount, clientMounted, serverMounted);
  const bridge = getRendererBridge(controller);
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getServerSnapshot);
  const marker = useRef<HTMLTemplateElement>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  useEffect(() => {
    if (!mounted || !marker.current) return;
    const ownerDocument = marker.current.ownerDocument;
    let container: Element;
    try {
      const requested = typeof options.container === 'function' ? options.container() : options.container;
      const candidate = requested ?? ownerDocument.body;
      // nodeType/ownerDocument also work when the mounting React root is in another realm.
      if (!candidate || candidate.nodeType !== 1 || candidate.ownerDocument !== ownerDocument
        || candidate.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !candidate.isConnected
        || candidate.getRootNode().nodeType === 11) {
        bridge.reportInvalidContainer('Toaster container must be a connected HTML Element in the mounting document, outside Shadow DOM');
        return;
      }
      container = candidate;
    } catch (error) {
      bridge.reportInvalidContainer('Toaster container resolver failed', error);
      return;
    }
    const delay = options.attention?.delay;
    let attached = bridge.attach(delay === undefined ? undefined : { attentionDelay: delay });
    // An invalid delay must not suppress the host: fall back to the controller default and report it.
    const invalidDelay = attached.status === 'rejected' && attached.reason === 'invalid-input';
    if (invalidDelay) attached = bridge.attach();
    if (attached.status !== 'attached') return;
    if (invalidDelay) bridge.reportDiagnostic(attached.lease, { code: 'invalid-input', source: 'Toaster.attention',
      message: 'attention.delay must be a finite nonnegative number of milliseconds' });
    const current = { controller, lease: attached.lease, container, document: ownerDocument };
    applyAutoDismiss(current.lease, false);
    setAttachment(current);
    return () => { bridge.detach(current.lease); };
    // Container and attention delay are fixed for this attachment; changing them requires remount.
  }, [controller, mounted]);
  // Applied before the first presentation, then whenever the prop changes (which reports an invalid value once).
  function applyAutoDismiss(lease: HostLease, report: boolean) {
    const value = options.autoDismiss;
    const valid = value === undefined || typeof value === 'boolean';
    bridge.setAutoDismiss(lease, valid ? value : undefined);
    if (!valid && report) bridge.reportDiagnostic(lease, { code: 'invalid-input', source: 'Toaster.autoDismiss',
      message: 'autoDismiss must be a boolean' });
  }
  useEffect(() => { if (attachment) applyAutoDismiss(attachment.lease, true); }, [attachment, options.autoDismiss]);

  if (!mounted) return null;
  return <><template ref={marker} />{attachment?.controller === controller && !snapshot.disposed
    ? createPortal(<Host key={attachment.lease} bridge={bridge} lease={attachment.lease} snapshot={snapshot}
      options={options} document={attachment.document} />, attachment.container) : null}</>;
}
