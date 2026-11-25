import { FaqItem } from '@/components/faq/faq-item';
import { KIT_FAQ } from '@/lib/kit-faq';

/** The kit's short FAQ on the sky: native disclosures, animated by FaqItem like the Toaster's and the picker's. */
export function KitFaq() {
  return (
    <section id="faq" aria-labelledby="kit-faq-title" className="kit-faq">
      <p className="kit-eyebrow">FAQ</p>
      <h2 id="kit-faq-title" className="kp-heading">
        Questions, <span>answered short.</span>
      </h2>
      <div className="faq-list">
        {KIT_FAQ.map((item) => (
          <FaqItem key={item.id} question={item.question} answer={item.answer} />
        ))}
      </div>
    </section>
  );
}
