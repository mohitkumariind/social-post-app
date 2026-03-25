import { redirect } from "next/navigation";

/** Root URL opens the admin dashboard (replaces default create-next-app welcome page). */
export default function Home() {
  redirect("/admin");
}
