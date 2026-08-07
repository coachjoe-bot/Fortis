// Stripe checkout island — split out of App.jsx so @stripe/react-stripe-js only
// downloads when checkout actually reaches the card form. Most sessions never
// open payment, so this trims the main bundle every boot pays to parse.
// Styling comes in via props (errColor/btnBase) so this chunk stays free of the
// App.jsx theme tokens.
//
// T37 (2026-08-07) card-first flow: this form now confirms a SetupIntent (card
// collection ONLY — no subscription exists yet), then hands the saved payment
// method id up via onCardSaved, which creates the subscription server-side with
// the card already attached. Abandoning this form leaves nothing behind in
// Stripe. onCardSaved must throw with a user-readable message on failure; its
// rejection is shown inline and the athlete can retry WITHOUT re-entering the
// card (a confirmed SetupIntent is single-use, so we keep the pm id and skip
// straight to the subscribe step on retry).
import { useState, useRef } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

// Inner form — lives inside <Elements> so it can use the Stripe hooks.
function PayForm({payLabel, onCardSaved, onSuccess, onEvent, errColor, btnBase}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting,setSubmitting] = useState(false);
  const [error,setError] = useState("");
  // Payment method saved by a successful confirmSetup. Survives a failed
  // subscribe so the retry doesn't re-confirm the (single-use) SetupIntent.
  const savedPm = useRef(null);

  const submit = async () => {
    if(!stripe||!elements||submitting) return;
    setSubmitting(true); setError("");
    onEvent?.("submit");

    // 1. Card collection — skipped on retry when the card already saved.
    if(!savedPm.current){
      let result;
      try {
        result = await stripe.confirmSetup({ elements, confirmParams: { return_url: window.location.href }, redirect: "if_required" });
      } catch(e){ setError("Something went wrong. Try again."); setSubmitting(false); return; }
      if(result.error){
        onEvent?.("confirm_failed", result.error.code || result.error.type);
        setError(result.error.message || "Card check failed. Check your details and try again.");
        setSubmitting(false);
        return;
      }
      const pm = result.setupIntent?.payment_method;
      savedPm.current = typeof pm === "string" ? pm : pm?.id || null;
      if(!savedPm.current){
        setError("Couldn't save your card. Try again.");
        setSubmitting(false);
        return;
      }
    }

    // 2. Subscribe with the saved card (server creates the subscription card-first).
    try {
      await onCardSaved(savedPm.current);
    } catch(e){
      onEvent?.("subscribe_failed", e?.message);
      setError(e?.message || "Couldn't activate your plan. Try again.");
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <div>
      <PaymentElement options={{layout:"tabs"}}/>
      {error && <div style={{color:errColor,fontSize:12,marginTop:10,textAlign:"center"}}>{error}</div>}
      <button onClick={submit} disabled={!stripe||submitting}
        style={{...btnBase,opacity:(!stripe||submitting)?0.7:1,cursor:(!stripe||submitting)?"not-allowed":"pointer"}}>
        {submitting ? "Processing..." : payLabel}
      </button>
    </div>
  );
}

export default function StripePayBlock({stripeObj, options, payLabel, onCardSaved, onSuccess, onEvent, errColor, btnBase}) {
  return (
    <Elements stripe={stripeObj} options={options}>
      <PayForm payLabel={payLabel} onCardSaved={onCardSaved} onSuccess={onSuccess} onEvent={onEvent} errColor={errColor} btnBase={btnBase}/>
    </Elements>
  );
}
