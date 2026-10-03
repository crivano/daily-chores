import { BottomNav } from "@/components/BottomNav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { TimezoneSender } from "@/components/TimezoneSender";

export default function AppLayout({ children }: React.PropsWithChildren) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-28 pt-8">
      {children}
      <BottomNav />
      <TimezoneSender />
      <ServiceWorkerRegister />
    </div>
  );
}
