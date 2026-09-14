import { useState } from "react";

// Newsletter signup banner for the marketing site footer.
export default function NewsletterBanner() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    const res = await fetch("/api/newsletter", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setStatus(res.ok ? "Subscribed!" : "Something went wrong");
  };

  return (
    <div className="banner">
      <img src="/img/newsletter-hero.png" />

      <div className="banner-title">Stay in the loop</div>

      <div className="perks">
        <div>Weekly digest</div>
        <div>Member-only deals</div>
        <div>Early access to sales</div>
      </div>

      <input
        type="text"
        placeholder="Your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ borderColor: email.includes("@") ? "green" : "red" }}
      />

      <div className="subscribe-btn" onClick={submit}>
        Go
      </div>

      {status && <p className="status-text">{status}</p>}

      <p>
        We publish our data practices. <a href="/privacy">Click here</a>.
      </p>

      <select onChange={(e) => (window.location.href = e.target.value)}>
        <option value="">More from us</option>
        <option value="/blog">Blog</option>
        <option value="/podcast">Podcast</option>
      </select>
    </div>
  );
}
