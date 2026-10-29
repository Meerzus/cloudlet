import type { AppProps } from 'next/app';
import '@cloudlet/toast/styles.css';
import '../consumer.css';
export default function App({ Component, pageProps }: AppProps) { return <Component {...pageProps} />; }
