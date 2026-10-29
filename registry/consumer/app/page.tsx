import { RegistryDemo } from './registry-demo';

export default function Page() {
  return <main><h1>Cloudlet registry consumer</h1><p data-testid="ssr">Server rendered without a controller singleton.</p><RegistryDemo /></main>;
}
