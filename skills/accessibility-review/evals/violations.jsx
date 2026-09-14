import { useState } from "react";

// Signup card added to the marketing site.
export default function SignupCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  return (
    <div>
      <img src="/img/hero-discount.png" />

      <div className="cta" onClick={() => setOpen(true)}>
        <img src="/icons/gift.svg" />
      </div>

      <input
        type="text"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ border: email.includes("@") ? "1px solid green" : "1px solid red" }}
      />

      <video src="/media/promo.mp4" autoPlay loop />

      {open && (
        <div className="modal">
          <p>You are signed up!</p>
          <span onClick={() => setOpen(false)}>x</span>
        </div>
      )}
    </div>
  );
}
