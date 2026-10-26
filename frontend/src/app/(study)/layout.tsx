import SectionBack from "@/components/SectionBack";

export default function StudyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionBack paths={["/practice", "/review"]} />
      {children}
    </>
  );
}
