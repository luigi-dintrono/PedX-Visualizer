import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { FilterSidebar } from "@/components/filter-sidebar"
import { InfoSidebar } from "@/components/info-sidebar"
import Globe from "@/components/Globe";

export default function Home() {
  return (
    <SidebarProvider>
      <div className="relative h-screen w-full">
        {/* Full-screen Cesium Globe Background */}
        <div className="absolute inset-0 z-0">
          <Globe />
        </div>

        {/* Left Sidebar */}
        <div className="absolute left-0 top-0 z-10">
          <FilterSidebar />
        </div>

        {/* Right Sidebar */}
        <div className="absolute right-0 top-0 z-10">
          <InfoSidebar />
        </div>

        {/* Top Bar with Sidebar Triggers */}
        <div className="absolute top-4 left-4 z-20">
          <SidebarTrigger />
        </div>
        <div className="absolute top-4 right-4 z-20">
          <SidebarTrigger />
        </div>
      </div>
    </SidebarProvider>
  );
}
