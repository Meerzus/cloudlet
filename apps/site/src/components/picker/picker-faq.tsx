import { FaqItem } from '@/components/faq/faq-item';
import { PICKER_FAQ } from '@/lib/picker-faq';

/** The color picker's short FAQ: native disclosures, animated by FaqItem like the Toaster's. */
export function PickerFaq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="faq-title" className="cp-section-title">questions</h2>
        <p className="cp-section-lede">About the registry, oklch, the eyedropper, clipping and labels.</p>
        <div className="faq-list">
          {PICKER_FAQ.map((item) => (
            <FaqItem key={item.id} question={item.question} answer={item.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}
