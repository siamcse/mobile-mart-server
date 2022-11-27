const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.leesidy.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    console.log(authHeader);
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(401).send({ message: 'Unauthorized access' });
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {

        const categoriesCollection = client.db('mobileMart').collection('categories');
        const productsCollection = client.db('mobileMart').collection('products');
        const usersCollection = client.db('mobileMart').collection('users');
        const bookingsCollection = client.db('mobileMart').collection('bookings');
        const reportProductsCollection = client.db('mobileMart').collection('reportProducts');
        const paymentsCollection = client.db('mobileMart').collection('payments');

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email };
            console.log(query);
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.SECRET_ACCESS_TOKEN, { expiresIn: '1h' });
                return res.send({ token: token });
            }
            res.status(403).send({ message: 'Unauthorized access', token: '' });
        });

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);
            if (user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            next();
        }

        //categories
        app.get('/categories', async (req, res) => {
            const query = {};
            const categories = await categoriesCollection.find(query).toArray();
            res.send(categories);
        });

        //get products by category id
        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { categoryId: id };
            const product = await productsCollection.find(query).toArray();
            res.send(product);
        })
        //get products by email
        app.get('/products', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const products = await productsCollection.find(query).toArray();
            res.send(products);
        })

        //save products
        app.post('/products', async (req, res) => {
            const product = req.body;
            const result = await productsCollection.insertOne(product);
            res.send(result);
        })
        //delete product
        app.delete('/products/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await productsCollection.deleteOne(query);
            res.send(result);
        })
        //advertise a product
        app.put('/products/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    advertise: true
                }
            };
            const result = await productsCollection.updateMany(filter, updateDoc, options);
            res.send(result);
        });

        //advertise product
        app.get('/adproducts', async (req, res) => {
            const query = { advertise: true };
            const products = await productsCollection.find(query).toArray();
            res.send(products);
        });

        //Report products 
        app.get('/reportProducts', async (req, res) => {
            const query = {};
            const products = await reportProductsCollection.find(query).toArray();
            res.send(products);
        })
        app.post('/reportProducts', async (req, res) => {
            const product = req.body;
            const query = { productId: product.productId };
            const alreadyReported = await reportProductsCollection.find(query).toArray();
            if (alreadyReported.length > 0) {
                return res.send({ message: "Already Reported" });
            }
            const result = await reportProductsCollection.insertOne(product);
            res.send({ message: 'Reported Successful', result });
        });
        app.delete('/reportProducts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await reportProductsCollection.deleteOne(query);
            res.send(result);

        })
        //bookings
        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        });
        //bookings get by id
        app.get('/bookings/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        });

        app.post('/bookings', verifyJWT, async (req, res) => {
            const booking = req.body;
            const query = {};
            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        });
        //bookings delete
        app.delete('/bookings/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await bookingsCollection.deleteOne(query);
            res.send(result);
        });

        //stripe payment
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                "payment_method_types": [
                    "card"
                ],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // payment 
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            //update products
            const productsId = payment.productsId;
            const filterProducts = { _id: ObjectId(productsId) };
            const updateProduct = {
                $set: {
                    isAvailable: false,
                    advertise: false,
                    paid: true,
                    transationId: payment.transactionId
                }
            };
            const updateProductResult = await productsCollection.updateOne(filterProducts, updateProduct);

            //update booking
            const filterBooking = { productsId: productsId };
            const updateBooking = {
                $set: {
                    paid: true,
                    transationId: payment.transactionId,

                }
            };
            const updateBookingResult = await bookingsCollection.updateMany(filterBooking, updateBooking);
            res.send(result);
        })

        //get admin
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        });
        //get seller
        app.get('/users/seller/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ isSeller: user?.role === 'Seller', seller: user });
        });
        //get all users by role
        app.get('/users', async (req, res) => {
            const role = req.query.role;
            const query = { role: role };
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        })

        //save User
        app.post('/users', async (req, res) => {
            const user = req.body;
            const filter = { email: user.email };
            const alreadyUser = await usersCollection.find(filter).toArray();
            if (alreadyUser) {
                return res.send({ acknowledged: true });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        //make seller verified
        app.put('/users/seller/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    verified: true
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            res.send(result);
        });

        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })

    }
    finally {

    }
}

run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Mobile mart server is running.');
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})