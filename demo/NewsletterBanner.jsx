import { useState } from "react";

// Newsletter signup banner for the marketing site footer.
export default function NewsletterBanner() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [destination, setDestination] = useState("");

  const submit = async () => {
    setStatus("Submitting...");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "Subscribed!" : "Something went wrong");
    } catch {
      setStatus("Unable to subscribe. Please try again.");
    }
  };

  return (
    <div className="banner">
      <img src="/img/newsletter-hero.png" alt="Newsletter" />

      <h2 className="banner-title">Stay in the loop</h2>

      <ul className="perks">
        <li>Weekly digest</li>
        <li>Member-only deals</li>
        <li>Early access to sales</li>
      </ul>

      <label htmlFor="newsletter-email">Your email</label>
      <input
        id="newsletter-email"
        type="email"
        autoComplete="email"
        placeholder="Your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-describedby="newsletter-email-error"
        aria-invalid={email.length > 0 && !email.includes("@")}
        style={{ borderColor: email.includes("@") ? "green" : "red" }}
      />
      <p id="newsletter-email-error" className="error-text">
        {email.length > 0 && !email.includes("@") ? "Enter a valid email address." : ""}
      </p>

      <button type="button" className="subscribe-btn" onClick={submit}>
        Go
      </button>

      <p className="status-text" role="status" aria-live="polite">{status}</p>

      <p>
        We publish our data practices. <a href="/privacy">Read our privacy policy</a>.
      </p>

      <label htmlFor="newsletter-destination">More from us</label>
      <select
        id="newsletter-destination"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">Choose a destination</option>
        <option value="/blog">Blog</option>
        <option value="/podcast">Podcast</option>
      </select>
      <button
        type="button"
        onClick={() => {
          if (destination) window.location.href = destination;
        }}
      >
        Go to destination
      </button>
    </div>
  );
}
