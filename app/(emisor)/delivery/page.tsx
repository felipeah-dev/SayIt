"use client";

/**
 * /app/(emisor)/delivery/page.tsx
 *
 * Final sealing and delivery confirmation screen.
 * Shows a summary of the capsule, confirms delivery settings,
 * then PATCH /api/capsule/[id] with sealed_at.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CapsuleData {
  id: string;
  recipient_name: string;
  delivery_type: "immediate" | "date" | "posthumous" | null;
  delivery_date: string | null;
  sealed_at: string | null;
}

type PageState = "loading" | "ready" | "confirming" | "sealed" | "error";

const DELIVERY_LABELS: Record<
  NonNullable<CapsuleData["delivery_type"]>,
  { title: string; description: string }
> = {
  immediate: {
    title: "Envío inmediato",
    description: "El enlace se enviará en cuanto confirmes.",
  },
  date: {
    title: "Fecha especial",
    description: "El mensaje llegará en la fecha que elegiste.",
  },
  posthumous: {
    title: "Legado póstumo",
    description:
      "Este mensaje quedará guardado hasta que alguien de tu confianza lo entregue.",
  },
};

export default function DeliveryPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [capsule, setCapsule] = useState<CapsuleData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem("capsule_id");
    if (!id) {
      router.replace("/onboarding");
      return;
    }

    const fetchCapsule = async () => {
      try {
        const res = await fetch(`/api/capsule/${id}`);
        if (!res.ok) throw new Error("No encontramos tu cápsula.");
        const data = (await res.json()) as CapsuleData;
        setCapsule(data);
        setPageState("ready");
      } catch {
        setErrorMessage(
          "No pudimos recuperar tu cápsula. Inténtalo de nuevo."
        );
        setPageState("error");
      }
    };

    void fetchCapsule();
  }, [router]);

  const handleSeal = async () => {
    if (!capsule) return;
    setPageState("confirming");
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/capsule/${capsule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sealed_at: new Date().toISOString() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(
          data.error ?? "No pudimos sellar tu cápsula. Inténtalo de nuevo."
        );
      }

      // Clear session data
      sessionStorage.removeItem("capsule_id");
      sessionStorage.removeItem("capsule_recipient");
      sessionStorage.removeItem("capsule_delivery_type");
      sessionStorage.removeItem("recording_blob_url");
      sessionStorage.removeItem("edited_video_url");

      setPageState("sealed");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Algo salió mal, pero tu mensaje está a salvo. Inténtalo de nuevo."
      );
      setPageState("ready");
    }
  };

  const formatDeliveryDate = (isoDate: string) => {
    return new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(isoDate));
  };

  // ── Loading ────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-beige flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-beige-dark border-t-terracota animate-spin" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────
  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="font-serif text-display-sm text-texto-principal italic max-w-narrow">
          Algo salió mal.
        </p>
        <p className="font-sans text-body-sm text-texto-muted max-w-narrow">
          {errorMessage}
        </p>
        <button
          onClick={() => router.push("/editor")}
          className="font-sans text-sm text-terracota hover:text-terracota-light transition-colors duration-300 underline underline-offset-4 decoration-terracota/30"
        >
          Volver al editor
        </button>
      </div>
    );
  }

  // ── Sealed confirmation ────────────────────────────────────
  if (pageState === "sealed") {
    return (
      <div className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-reading space-y-8 animate-fade-in-up">
          {/* Ceremonial mark */}
          <div className="w-16 h-px bg-terracota/30 mx-auto" />

          <p className="font-serif text-display-md text-texto-principal italic leading-snug">
            Tu mensaje está guardado.
          </p>

          <p className="font-sans text-body-md text-texto-suave leading-relaxed max-w-narrow mx-auto">
            Cuando llegue el momento,{" "}
            <span className="font-medium text-texto-principal">
              {capsule?.recipient_name ?? "esa persona"}
            </span>{" "}
            sabrá.
          </p>

          <div className="w-16 h-px bg-terracota/20 mx-auto" />

          <p className="font-sans text-sm text-texto-muted">
            Dijiste lo que tenías que decir.
          </p>

          <button
            onClick={() => router.push("/onboarding")}
            className="
              font-sans text-sm font-medium
              text-texto-suave border border-beige-dark
              rounded-pill px-8 py-3
              hover:border-texto-suave/40 hover:text-texto-principal
              active:scale-[0.98]
              transition-all duration-300
            "
          >
            Ir al inicio
          </button>
        </div>
      </div>
    );
  }

  // ── Ready / Confirming ─────────────────────────────────────
  const deliveryInfo = capsule?.delivery_type
    ? DELIVERY_LABELS[capsule.delivery_type]
    : null;

  return (
    <main className="min-h-screen bg-beige flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-reading space-y-12 animate-fade-in">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-serif text-display-sm text-texto-principal italic mb-3">
            Casi listo.
          </h1>
          <p className="font-sans text-body-sm text-texto-muted">
            Un último paso antes de sellar tu cápsula.
          </p>
        </div>

        {/* Capsule summary card */}
        {capsule && (
          <div className="bg-white/60 border border-beige-dark rounded-card p-8 space-y-6">
            {/* Recipient */}
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-1 h-full self-stretch min-h-[2rem] bg-terracota/20 rounded-full" />
              <div>
                <p className="font-sans text-xs uppercase tracking-widest text-texto-muted mb-1">
                  Para
                </p>
                <p className="font-serif text-xl text-texto-principal">
                  {capsule.recipient_name}
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-beige-dark" />

            {/* Delivery type */}
            {deliveryInfo && (
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-1 h-full self-stretch min-h-[2rem] bg-azul-medio/20 rounded-full" />
                <div>
                  <p className="font-sans text-xs uppercase tracking-widest text-texto-muted mb-1">
                    Entrega
                  </p>
                  <p className="font-serif text-lg text-texto-principal mb-1">
                    {deliveryInfo.title}
                  </p>
                  <p className="font-sans text-sm text-texto-muted">
                    {deliveryInfo.description}
                  </p>
                  {capsule.delivery_type === "date" &&
                    capsule.delivery_date && (
                      <p className="font-sans text-sm text-azul-medio mt-2">
                        {formatDeliveryDate(capsule.delivery_date)}
                      </p>
                    )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Posthumous info block */}
        {capsule?.delivery_type === "posthumous" && (
          <div className="bg-azul-profundo/5 border border-azul-profundo/10 rounded-card p-6 space-y-3">
            <p className="font-sans text-sm font-medium text-azul-profundo">
              Cómo funciona la entrega póstuma
            </p>
            <p className="font-sans text-sm text-texto-suave leading-relaxed">
              Tu cápsula quedará protegida de forma segura. Podrás designar a
              una persona de confianza como responsable de entregarla. Recibirá
              las instrucciones necesarias para que tu mensaje llegue cuando
              corresponda.
            </p>
          </div>
        )}

        {errorMessage && (
          <p
            role="alert"
            className="font-sans text-sm text-terracota bg-terracota/5 rounded-soft px-4 py-3 border border-terracota/10"
          >
            {errorMessage}
          </p>
        )}

        {/* CTA */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => void handleSeal()}
            disabled={pageState === "confirming"}
            className="
              w-full
              font-sans text-body-sm font-medium
              bg-terracota text-beige
              rounded-pill px-8 py-4
              hover:bg-terracota-light
              active:scale-[0.98]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-all duration-300
            "
          >
            {pageState === "confirming"
              ? "Sellando tu cápsula…"
              : capsule?.delivery_type === "immediate"
              ? "Enviar ahora"
              : "Sellar mi cápsula"}
          </button>

          <button
            onClick={() => router.push("/editor")}
            disabled={pageState === "confirming"}
            className="
              font-sans text-sm text-texto-muted
              hover:text-texto-suave
              disabled:opacity-40
              transition-colors duration-300
              text-center
            "
          >
            Volver al editor
          </button>
        </div>
      </div>
    </main>
  );
}
