import SectionBack from "@/components/SectionBack";

export default function ErrorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionBack paths={["/feedback", "/mistakes"]} />
      {children}
    </>
  );
}
