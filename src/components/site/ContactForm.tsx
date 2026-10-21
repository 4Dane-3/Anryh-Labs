"use client";

import { useState } from "react";
import { CONTACT_EMAIL } from "@/components/site/SiteChrome";

const inputClass = "sb-input";

const TOPICS = ["general question", "requesting an invite", "my ads", "billing", "my data"];

/** Opens the visitor's email app with the message addressed to us, so help goes straight to our inbox. */
export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", topic: TOPICS[0], message: "" });
  const [opened, setOpened] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const subject = `${form.topic} · ${form.name}`;
    const body = `${form.message}\n\n${form.name}\n${form.email}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <form onSubmit={submit} className="sb-form">
      <div className="sb-form__two">
        <div>
          <label htmlFor="name" className="sb-label">
            name
          </label>
          <input id="name" required autoComplete="name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="email" className="sb-label">
            email
          </label>
          <input id="email" type="email" required autoComplete="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor="topic" className="sb-label">
          topic
        </label>
        <select id="topic" className={inputClass} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="message" className="sb-label">
          message
        </label>
        <textarea id="message" required rows={5} className={inputClass} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </div>
      <button type="submit" className="sb-cta sb-form__go">
        send message
      </button>
      <p className="sb-form__note">
        {opened
          ? `your email app should have opened. if it didn't, email ${CONTACT_EMAIL} directly.`
          : `opens your email app with the message addressed to ${CONTACT_EMAIL}.`}
      </p>
    </form>
  );
}
