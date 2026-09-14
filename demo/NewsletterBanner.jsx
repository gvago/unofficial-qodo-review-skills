import { useState } from "react";

// Newsletter signup banner for the marketing site footer.
export default function NewsletterBanner() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [topic, setTopic] = useState("");
  const [emailError, setEmailError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!email.includes("@")) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "Subscribed!" : "Something went wrong");
    } catch {
      setStatus("We couldn't subscribe you. Please try again.");
    }
  };

  return (
    <div className="banner">
      <img src="/img/newsletter-hero.png" alt="" />

      <h2 className="banner-title">Stay in the loop</h2>

      <ul className="perks">
        <li>Weekly digest</li>
        <li>Member-only deals</li>
        <li>Early access to sales</li>
      </ul>

      <form onSubmit={submit}>
        <label htmlFor="newsletter-email">Email address</label>
        <input
          id="newsletter-email"
          type="email"
          autoComplete="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailError ? "true" : "false"}
          aria-describedby={emailError ? "newsletter-email-error" : undefined}
          style={{ borderColor: emailError ? "red" : email.includes("@") ? "green" : undefined }}
        />
        {emailError && <p id="newsletter-email-error">{emailError}</p>}
        <button type="submit" className="subscribe-btn">
          Go
        </button>
      </form>

      <p className="status-text" role="status">{status}</p>

      <p>
        We publish our data practices. <a href="/privacy">Privacy policy</a>.
      </p>

      <select value={topic} onChange={(e) => setTopic(e.target.value)}>
        <option value="">More from us</option>
        <option value="/blog">Blog</option>
        <option value="/podcast">Podcast</option>
      </select>
      <button type="button" disabled={!topic} onClick={() => { window.location.href = topic; }}>
        Go to selected topic
      </button>
    </div>
  );
}
