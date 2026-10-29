import Document, { Html, Head, Main, NextScript } from 'next/document';
import type { DocumentContext } from 'next/document';
export default class CloudletDocument extends Document<{ nonce: string }> {
  static override async getInitialProps(context: DocumentContext) {
    return { ...await Document.getInitialProps(context), nonce: String(context.req?.headers['x-nonce'] ?? '') };
  }
  override render() { return <Html lang="en"><Head nonce={this.props.nonce}><script src="/audit.js" nonce={this.props.nonce} /></Head><body><Main /><NextScript nonce={this.props.nonce} /></body></Html>; }
}
