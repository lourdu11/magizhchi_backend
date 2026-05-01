require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');
const Category = require('./src/models/Category');
const Inventory = require('./src/models/Inventory');
const slugify = require('slugify');

const IMAGE_URLS = [
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0099.jpg?updatedAt=1772379298578",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0101.jpg?updatedAt=1772379298570",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0094.jpg?updatedAt=1772379295629",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0074.jpg?updatedAt=1772379295411",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0095.jpg?updatedAt=1772379295271",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0100.jpg?updatedAt=1772379295007",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0083.jpg?updatedAt=1772379294872",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0089.jpg?updatedAt=1772379294692",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0085.jpg?updatedAt=1772379294664",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0081.jpg?updatedAt=1772379294557",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0070.jpg?updatedAt=1772379293991",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0072.jpg?updatedAt=1772379293812",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0077.jpg?updatedAt=1772379293485",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0090.jpg?updatedAt=1772379293524",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0084.jpg?updatedAt=1772379293123",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0092.jpg?updatedAt=1772379292854",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0096.jpg?updatedAt=1772379292358",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0048.jpg?updatedAt=1772379292131",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0091.jpg?updatedAt=1772379292098",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0087.jpg?updatedAt=1772379291871",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0079.jpg?updatedAt=1772379291779",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0073.jpg?updatedAt=1772379291564",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0066.jpg?updatedAt=1772379291296",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0078.jpg?updatedAt=1772379290800",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0082.jpg?updatedAt=1772379290685",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0046.jpg?updatedAt=1772379290678",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0075.jpg?updatedAt=1772379290468",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0067.jpg?updatedAt=1772379290063",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0061.jpg?updatedAt=1772379290006",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0042.jpg?updatedAt=1772379289442",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0093.jpg?updatedAt=1772379289368",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0088.jpg?updatedAt=1772379289123",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0068.jpg?updatedAt=1772379288445",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0045.jpg?updatedAt=1772379287006",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0062.jpg?updatedAt=1772379285382",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0055.jpg?updatedAt=1772379283539",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0057.jpg?updatedAt=1772379281822",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0064.jpg?updatedAt=1772379278479",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0053.jpg?updatedAt=1772379275766",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0049.jpg?updatedAt=1772379275637",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0051.jpg?updatedAt=1772379274445",
    "https://ik.imagekit.io/Lourdu/magizhchi_garments/maghchi%20image/IMG-20251126-WA0047.jpg?updatedAt=1772379273809"
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/magizhchi');
        console.log('Connected to MongoDB');

        // ── CLEANUP ──
        console.log('Cleaning up existing products and inventory...');
        await Product.deleteMany({});
        await Inventory.deleteMany({});
        console.log('Cleanup complete.');

        // 1. Get or Create Categories
        let shirtCat = await Category.findOne({ name: 'shirt' });
        let pantCat = await Category.findOne({ name: 'pant' });
        
        let ethnicCat = await Category.findOne({ name: 'ethnic wear' });
        if (!ethnicCat) {
            ethnicCat = await Category.create({ 
                name: 'ethnic wear', 
                slug: 'ethnic-wear', 
                description: 'Traditional and elegant ethnic wear',
                image: IMAGE_URLS[0]
            });
        }

        let casualCat = await Category.findOne({ name: 'casual wear' });
        if (!casualCat) {
            casualCat = await Category.create({ 
                name: 'casual wear', 
                slug: 'casual-wear', 
                description: 'Comfortable everyday casual wear',
                image: IMAGE_URLS[5]
            });
        }

        const cats = [shirtCat, pantCat, ethnicCat, casualCat];

        console.log('Categories ready. Seeding products...');

        for (let i = 0; i < IMAGE_URLS.length; i++) {
            const url = IMAGE_URLS[i];
            // Extract WA ID from URL: IMG-20251126-WA0099.jpg -> WA0099
            const match = url.match(/WA(\d+)/);
            const waId = match ? match[1] : i;
            
            const category = cats[i % cats.length];
            const name = `Premium ${category.name.charAt(0).toUpperCase() + category.name.slice(1)} Collection #${waId}`;
            const sku = `MG-${waId}-${i}`;
            
            const product = await Product.create({
                name,
                slug: slugify(name + '-' + i, { lower: true }),
                sku,
                description: `Exclusive premium quality ${category.name} from Magizhchi Garments. High durability and comfortable fabric.`,
                category: category._id,
                basePrice: 100, // For cost tracking
                sellingPrice: 1, // USER REQUESTED: 1 Rupee
                taxRate: 18,
                images: [url],
                isActive: true,
                isFeatured: i < 10 // Feature first 10
            });

            // Add Inventory for variants (Separate documents)
            const sizes = ['M', 'L', 'XL'];
            for (const size of sizes) {
                const variantSku = `${sku}-${size}`;
                await Inventory.create({
                    productName: name,
                    category: category.name,
                    color: 'Classic',
                    size: size,
                    sku: variantSku,
                    productRef: product._id,
                    totalStock: 100,
                    purchasePrice: 50,
                    sellingPrice: 1,
                    lowStockThreshold: 10,
                    images: [url]
                });
            }

            console.log(`Added: ${name}`);
        }

        console.log('✅ SEEDING COMPLETE!');
        process.exit(0);
    } catch (err) {
        console.error('❌ SEEDING FAILED:', err);
        process.exit(1);
    }
};

seed();
