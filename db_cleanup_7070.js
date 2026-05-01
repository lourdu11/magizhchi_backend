const mongoose = require('mongoose');

async function cleanDB() {
  await mongoose.connect('mongodb://localhost:27017/magizhchi');
  console.log('Connected to DB');

  const collections = await mongoose.connection.db.listCollections().toArray();
  
  for (const col of collections) {
    const name = col.name;
    const collection = mongoose.connection.db.collection(name);
    
    // Find any document that contains localhost:7070 in any field
    // Since we don't know the schema for all collections, we'll check common fields
    const query = {
      $or: [
        { image: /7070/ },
        { images: /7070/ },
        { url: /7070/ },
        { path: /7070/ },
        { sizeChart: /7070/ },
        { logo: /7070/ }
      ]
    };

    const items = await collection.find(query).toArray();
    if (items.length > 0) {
      console.log(`Found ${items.length} items in ${name} with localhost:7070`);
      
      for (const item of items) {
        let updated = false;
        const newItem = { ...item };
        
        // Helper to replace 7070 with 5000 (current port) or make relative
        const fix = (val) => {
          if (typeof val === 'string' && val.includes('localhost:7070')) {
            updated = true;
            return val.replace('http://localhost:7070', '').replace('http://localhost:5000', '');
          }
          if (Array.isArray(val)) {
            return val.map(v => {
              if (typeof v === 'string' && v.includes('localhost:7070')) {
                updated = true;
                return v.replace('http://localhost:7070', '').replace('http://localhost:5000', '');
              }
              return v;
            });
          }
          return val;
        };

        ['image', 'images', 'url', 'path', 'sizeChart', 'logo'].forEach(field => {
          if (newItem[field]) newItem[field] = fix(newItem[field]);
        });

        if (updated) {
          await collection.updateOne({ _id: item._id }, { $set: newItem });
          console.log(`Fixed item ${item._id} in ${name}`);
        }
      }
    }
  }
  
  console.log('Cleanup complete');
  process.exit();
}

cleanDB().catch(err => {
  console.error(err);
  process.exit(1);
});
