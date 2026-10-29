import type { GetServerSideProps } from 'next';
import { Consumer } from '../consumer';
export default Consumer;
export const getServerSideProps: GetServerSideProps = async context => ({ props: { nonce: context.req.headers['x-nonce'] ?? '' } });
