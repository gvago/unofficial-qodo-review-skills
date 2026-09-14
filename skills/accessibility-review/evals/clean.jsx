import { useEffect, useRef, useState } from "react";

// Signup card added to the marketing site.
export default function SignupCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
    else triggerRef.current?.focus();
  }, [open]);

  const valid = email.includes("@");

  return (
    <div>
      <img src="/img/hero-discount.png" alt="20% off your first order" />

      <button ref={triggerRef} className="cta" onClick={() => setOpen(true)}>
        <img src="/icons/gift.svg" alt="" aria-hidden="true" />
        Claim discount
      </button>

      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        type="email"
        autoComplete="email"
        value={email}
        aria-invalid={!valid && email !== ""}
        aria-describedby="signup-email-error"
        onChange={(e) => {
          setEmail(e.target.value);
          setError(e.target.value.includes("@") ? "" : "Enter a valid email address");
        }}
      />
      <p id="signup-email-error" role="alert">{error}</p>

      <video src="/media/promo.mp4" controls muted>
        <track kind="captions" src="/media/promo.en.vtt" srcLang="en" label="English" />
      </video>

      {open && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Signup confirmation"
          ref={dialogRef}
          tabIndex={-1}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          <p>You are signed up!</p>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
