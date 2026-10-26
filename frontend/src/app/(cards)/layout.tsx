import SectionBack from "@/components/SectionBack";

export default function CardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionBack paths={["/flashcards", "/vocabulary"]} />
      {children}
    </>
  );
}
