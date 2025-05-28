import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Success() {
  const router = useRouter();
  const { product_id } = router.query;
  const [telegramLink, setTelegramLink] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (product_id) {
      fetch('/products.json')
        .then((res) => res.json())
        .then((data) => {
          const product = data.find((p) => p.id === parseInt(product_id));
          if (product && product.telegramLink) {
            setTelegramLink(product.telegramLink);
            setTimeout(() => {
              window.location.href = product.telegramLink;
            }, 5000); // Redirect after 5 seconds
          }
          setIsLoading(false);
        })
        .catch((error) => {
          console.error('Error loading product:', error);
          setIsLoading(false);
        });
    }
  }, [product_id]);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-grow">
        <div className="container mx-auto px-4 py-12">
          <div className="success-card">
            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
              </div>
            ) : telegramLink ? (
              <>
                <h1 className="text-3xl font-bold text-center mb-4">Payment Successful!</h1>
                <p className="text-center text-gray-600 mb-6">
                  Thank you for your purchase. You will be redirected to the Material in 5 seconds,
                </p>
                <p className="text-center">
                  <a href={telegramLink} className="text-indigo-600 hover:text-indigo-800 transition-colors">
                    Click here to join now
                  </a>
                </p>
              </>
            ) : (
              <p className="text-center text-gray-600">Error: Telegram link not found.</p>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
