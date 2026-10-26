import SectionBack from "@/components/SectionBack";

export default function SpeakingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionBack paths={["/scenarios", "/pronunciation", "/dictation"]} />
      {children}
    </>
  );
}
