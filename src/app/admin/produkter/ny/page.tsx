import { Produktformular } from "@/components/produktformular";
import { skapaProdukt } from "@/app/admin/produkter/actions";

export const dynamic = "force-dynamic";

export default function NyProdukt() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Ny produkt</h1>
      <Produktformular
        action={skapaProdukt}
        knapptext="Spara produkt"
        start={{
          namn: "",
          beskrivning: "",
          prisKronor: "",
          bilder: [],
          aktiv: true,
          sortering: 0,
          storlekar: ["Onesize"],
          farger: ["Enfärgad"],
          lager: {},
        }}
      />
    </div>
  );
}
