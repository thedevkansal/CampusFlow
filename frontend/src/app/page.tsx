import Link from "next/link";
import { ArrowRight, MapPin, Clock, ShieldCheck, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/navbar";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-20 md:py-32 px-4 container mx-auto text-center">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary hover:bg-primary/20 mb-6">
              Now live at E-Summit 2026
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-slate-900">
              Campus commutes,<br />
              <span className="text-primary">reimagined.</span>
            </h1>
            <p className="text-xl text-slate-600">
              The fastest way to get across campus. Designed for students, 
              built for convenience. Real-time matching, transparent pricing.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
              <Link href="/register">
                <Button size="lg" className="text-lg">
                  Get Started <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="text-lg">
                  Driver Login
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 bg-white">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-center mb-16 text-slate-900">How it works</h2>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-slate-50 p-8 rounded-2xl flex flex-col items-center text-center space-y-4">
                <div className="bg-primary/10 p-4 rounded-full">
                  <MapPin className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">1. Set your route</h3>
                <p className="text-slate-600">Select your pickup location and destination within the campus geo-fence.</p>
              </div>
              
              <div className="bg-slate-50 p-8 rounded-2xl flex flex-col items-center text-center space-y-4">
                <div className="bg-primary/10 p-4 rounded-full">
                  <Clock className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">2. Get matched fast</h3>
                <p className="text-slate-600">Our real-time engine connects you with the nearest available driver instantly.</p>
              </div>
              
              <div className="bg-slate-50 p-8 rounded-2xl flex flex-col items-center text-center space-y-4">
                <div className="bg-primary/10 p-4 rounded-full">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">3. Ride safely</h3>
                <p className="text-slate-600">Track your ride in real-time, share your trip, and pay a transparent fare.</p>
              </div>
            </div>
          </div>
        </section>
        
        {/* Dual Benefits Section */}
        <section className="py-20 bg-slate-50">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="grid md:grid-cols-2 gap-16">
              <div className="space-y-6">
                <h3 className="text-3xl font-bold text-slate-900">For Passengers</h3>
                <ul className="space-y-4">
                  <li className="flex gap-3">
                    <div className="mt-1 bg-white p-1 rounded-full border shadow-sm h-fit">
                      <ArrowRight className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Zero Surge Pricing</h4>
                      <p className="text-sm text-slate-600">Flat base fare plus per-km rate. Always predictable.</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="mt-1 bg-white p-1 rounded-full border shadow-sm h-fit">
                      <ArrowRight className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Live Tracking</h4>
                      <p className="text-sm text-slate-600">See your driver moving on the map with sub-second latency.</p>
                    </div>
                  </li>
                </ul>
              </div>
              
              <div className="space-y-6">
                <h3 className="text-3xl font-bold text-slate-900">For Drivers</h3>
                <ul className="space-y-4">
                  <li className="flex gap-3">
                    <div className="mt-1 bg-white p-1 rounded-full border shadow-sm h-fit">
                      <Car className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Flexible Hours</h4>
                      <p className="text-sm text-slate-600">Toggle online status instantly. Work around your classes.</p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="mt-1 bg-white p-1 rounded-full border shadow-sm h-fit">
                      <Car className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">Smart Routing</h4>
                      <p className="text-sm text-slate-600">Our BullMQ-powered engine assigns you the closest rides.</p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 py-12 text-slate-400">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4 text-white">
            <Car className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">CampusFlow</span>
          </div>
          <p className="text-sm mb-6">Designed and engineered for a seamless campus experience.</p>
          <div className="text-xs border-t border-slate-800 pt-8">
            &copy; 2026 CampusFlow. Built for E-Summit.
          </div>
        </div>
      </footer>
    </div>
  );
}
