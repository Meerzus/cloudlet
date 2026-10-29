import { headers } from 'next/headers';
import { Consumer } from '../consumer';
export default async function Page() {
  return <Consumer nonce={(await headers()).get('x-nonce') ?? ''} />;
}
