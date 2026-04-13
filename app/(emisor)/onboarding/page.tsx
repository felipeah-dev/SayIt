"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type DeliveryType = "immediate" | "date" | "posthumous";

interface FormData {
  recipientName: string;
  recipientContact: string;
  deliveryType: DeliveryType | null;
  deliveryDate: string;
}

const DELIVERY_OPTIONS: {
  value: DeliveryType;
  label: string;
  description: string;
}[] = [
  {
    value: "immediate",
    label: "Ahora mismo",
    description: "Se enviará en cuanto termines",
  },
  {
    value: "date",
    label: "En una fecha especial",
    description: "Elige cuándo debe llegar",
  },
  {
    value: "posthumous",
    label: "Cuando ya no esté",
    description: "Un legado para el futuro",
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    recipientName: "",
    recipientContact: "",
    deliveryType: null,
    deliveryDate: "",
  });

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.recipientName.trim()) {
      setError("Por favor, cuéntanos a quién va dirigido este mensaje.");
      return;
    }
    if (!formData.recipientContact.trim()) {
      setError(
        "Necesitamos saber cómo encontrar a esa persona cuando llegue el momento."
      );
      return;
    }
    setStep(2);
  };

  const handleFinalSubmit = useCallback(async () => {
    if (!formData.deliveryType) {
      setError("Por favor, elige cuándo debe recibir este mensaje.");
      return;
    }
    if (formData.deliveryType === "date" && !formData.deliveryDate) {
      setError("Elige una fecha para que este mensaje llegue en el momento justo.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        recipient_name: formData.recipientName.trim(),
        recipient_contact: formData.recipientContact.trim(),
        delivery_type: formData.deliveryType,
      };

      if (formData.deliveryType === "date" && formData.deliveryDate) {
        body.delivery_date = new Date(formData.deliveryDate).toISOString();
      }

      const res = await fetch("/api/capsule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(
          data.error ??
            "Algo salió mal, pero tu intención está a salvo. Inténtalo de nuevo."
        );
      }

      const capsule = (await res.json()) as { id: string };
      sessionStorage.setItem("capsule_id", capsule.id);
      sessionStorage.setItem(
        "capsule_recipient",
        formData.recipientName.trim()
      );
      sessionStorage.setItem(
        "capsule_delivery_type",
        formData.deliveryType
      );

      router.push("/interview");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Algo salió mal, pero tu mensaje está a salvo. Inténtalo de nuevo."
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, router]);

  const today = new Date().toISOString().split("T")[0];

  return (
    <main className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-reading">
        {/* Wordmark */}
        <div className="text-center mb-16">
          <h1 className="font-serif text-display-lg text-texto-principal italic">
            Say It
          </h1>
          <p className="font-sans text-body-sm text-texto-muted mt-2">
            Di lo que llevas tiempo queriendo decir.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-12">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-3">
              <div
                className={`
                  w-2 h-2 rounded-full transition-all duration-500
                  ${
                    s === step
                      ? "bg-terracota w-6"
                      : s < step
                      ? "bg-terracota/40"
                      : "bg-beige-dark"
                  }
                `}
              />
              {s < 2 && (
                <div
                  className={`w-8 h-px transition-colors duration-500 ${
                    step > s ? "bg-terracota/30" : "bg-beige-dark"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1 — Who is this for? */}
        {step === 1 && (
          <form
            onSubmit={handleStep1Submit}
            className="space-y-8 animate-fade-in-up"
          >
            <div className="text-center mb-10">
              <h2 className="font-serif text-display-sm text-texto-principal italic mb-3">
                ¿A quién quieres decirle algo importante?
              </h2>
              <p className="font-sans text-body-sm text-texto-muted">
                Puede ser un nombre, un apodo, como tú los llamas.
              </p>
            </div>

            {/* Recipient name */}
            <div className="space-y-2">
              <label
                htmlFor="recipientName"
                className="block font-sans text-sm font-medium text-texto-suave"
              >
                ¿Cómo se llama?
              </label>
              <input
                id="recipientName"
                type="text"
                value={formData.recipientName}
                onChange={(e) =>
                  setFormData((d) => ({
                    ...d,
                    recipientName: e.target.value,
                  }))
                }
                placeholder="Mi padre, Elena, Abuela…"
                autoComplete="off"
                className="
                  w-full
                  font-serif text-body-md text-texto-principal
                  bg-white/60 border border-beige-dark
                  rounded-card px-5 py-4
                  placeholder:font-sans placeholder:text-texto-muted/60 placeholder:font-light
                  focus:outline-none focus:border-terracota/40 focus:bg-white/80
                  transition-all duration-300
                "
              />
            </div>

            {/* Contact */}
            <div className="space-y-2">
              <label
                htmlFor="recipientContact"
                className="block font-sans text-sm font-medium text-texto-suave"
              >
                ¿Cómo podemos encontrarle?
              </label>
              <input
                id="recipientContact"
                type="text"
                value={formData.recipientContact}
                onChange={(e) =>
                  setFormData((d) => ({
                    ...d,
                    recipientContact: e.target.value,
                  }))
                }
                placeholder="Email o número de teléfono"
                autoComplete="off"
                className="
                  w-full
                  font-sans text-body-sm text-texto-principal
                  bg-white/60 border border-beige-dark
                  rounded-card px-5 py-4
                  placeholder:text-texto-muted/60 placeholder:font-light
                  focus:outline-none focus:border-terracota/40 focus:bg-white/80
                  transition-all duration-300
                "
              />
              <p className="font-sans text-xs text-texto-muted/70">
                Solo lo usaremos para entregar tu mensaje. Nada más.
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="font-sans text-sm text-terracota bg-terracota/5 rounded-soft px-4 py-3 border border-terracota/10"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="
                w-full
                font-sans text-body-sm font-medium
                bg-azul-profundo text-beige
                rounded-pill px-8 py-4
                hover:bg-azul-medio
                active:scale-[0.98]
                transition-all duration-300
              "
            >
              Continuar
            </button>
          </form>
        )}

        {/* Step 2 — When should it arrive? */}
        {step === 2 && (
          <div className="space-y-8 animate-fade-in-up">
            <div className="text-center mb-10">
              <h2 className="font-serif text-display-sm text-texto-principal italic mb-3">
                ¿Cuándo debe recibir este mensaje?
              </h2>
              <p className="font-sans text-body-sm text-texto-muted">
                Para{" "}
                <span className="font-medium text-texto-suave">
                  {formData.recipientName}
                </span>
              </p>
            </div>

            {/* Delivery options */}
            <div className="space-y-3">
              {DELIVERY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setFormData((d) => ({
                      ...d,
                      deliveryType: option.value,
                      deliveryDate:
                        option.value !== "date" ? "" : d.deliveryDate,
                    }))
                  }
                  className={`
                    w-full text-left p-5 rounded-card
                    border transition-all duration-300
                    ${
                      formData.deliveryType === option.value
                        ? "bg-azul-profundo text-beige border-azul-profundo shadow-md"
                        : "bg-white/60 border-beige-dark hover:border-azul-medio/30 hover:bg-white/80"
                    }
                  `}
                >
                  <p
                    className={`font-serif text-lg mb-0.5 ${
                      formData.deliveryType === option.value
                        ? "text-beige"
                        : "text-texto-principal"
                    }`}
                  >
                    {option.label}
                  </p>
                  <p
                    className={`font-sans text-sm ${
                      formData.deliveryType === option.value
                        ? "text-beige/60"
                        : "text-texto-muted"
                    }`}
                  >
                    {option.description}
                  </p>
                </button>
              ))}
            </div>

            {/* Date picker — only if "date" selected */}
            {formData.deliveryType === "date" && (
              <div className="space-y-2 animate-fade-in">
                <label
                  htmlFor="deliveryDate"
                  className="block font-sans text-sm font-medium text-texto-suave"
                >
                  ¿En qué fecha debe llegar?
                </label>
                <input
                  id="deliveryDate"
                  type="date"
                  min={today}
                  value={formData.deliveryDate}
                  onChange={(e) =>
                    setFormData((d) => ({
                      ...d,
                      deliveryDate: e.target.value,
                    }))
                  }
                  className="
                    w-full
                    font-sans text-body-sm text-texto-principal
                    bg-white/60 border border-beige-dark
                    rounded-card px-5 py-4
                    focus:outline-none focus:border-terracota/40 focus:bg-white/80
                    transition-all duration-300
                  "
                />
              </div>
            )}

            {/* Posthumous explanation */}
            {formData.deliveryType === "posthumous" && (
              <div className="animate-fade-in bg-azul-profundo/5 border border-azul-profundo/10 rounded-card p-5">
                <p className="font-sans text-sm text-texto-suave leading-relaxed">
                  Este mensaje quedará guardado de forma segura. Podrás designar
                  a alguien de confianza para que lo entregue cuando llegue el
                  momento. Te daremos más detalles una vez que termines de
                  grabarte.
                </p>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="font-sans text-sm text-terracota bg-terracota/5 rounded-soft px-4 py-3 border border-terracota/10"
              >
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
                className="
                  flex-shrink-0
                  font-sans text-body-sm font-medium
                  text-texto-suave border border-beige-dark
                  rounded-pill px-6 py-4
                  hover:border-texto-suave/40 hover:text-texto-principal
                  active:scale-[0.98]
                  transition-all duration-300
                "
              >
                Volver
              </button>

              <button
                type="button"
                onClick={() => void handleFinalSubmit()}
                disabled={isSubmitting || !formData.deliveryType}
                className="
                  flex-1
                  font-sans text-body-sm font-medium
                  bg-terracota text-beige
                  rounded-pill px-8 py-4
                  hover:bg-terracota-light
                  active:scale-[0.98]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-all duration-300
                "
              >
                {isSubmitting ? "Un momento…" : "Empezar a grabarte"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
