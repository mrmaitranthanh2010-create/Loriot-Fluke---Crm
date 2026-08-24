import type { Metadata } from "next";
import { CrmApp } from "./crm-app";

export const metadata: Metadata = {
  title: "Loriot CRM | Mai Trần Thành",
  description: "CRM cá nhân của Mai Trần Thành tại Loriot Industrial.",
};

export default function Home() {
  return <CrmApp />;
}
