import {
    Record,
    nat64,
    StableBTreeMap,
    float64,
    Opt,
    Vec,
    nat16,
    match,
    Result,
    $query,
    $update,
    ic,
    Principal,
  } from "azle";
  import { v4 as uuidv4 } from "uuid";
  
  // Define the structure for CartItem
  type CartItem = Record<{
    id: string;
    cartId: string;
    name: string;
    price: float64;
    quantity: nat16;
    createdAt: nat64;
    updatedAt: Opt<nat64>;
  }>;
  
  // Define the payload structure for CartItem
  type CartItemPayload = Record<{
    name: string;
    price: float64;
    quantity: nat16;
  }>;
  
  // Define the structure for Cart
  type Cart = Record<{
    id: string;
    principal: Principal;
    cartItems: Vec<string>;
    totalPrice: float64;
    createdAt: nat64;
    updatedAt: Opt<nat64>;
  }>;
  
  // Initialize storage for carts and cart items
  const cartStorage = new StableBTreeMap<string, Cart>(0, 44, 1024);
  const cartItemStorage = new StableBTreeMap<string, CartItem>(1, 44, 1024);

// Helper function that trims the input string and then checks the length
// The string is empty if true is returned, otherwise, string is a valid value
function isInvalidString(str: string): boolean {
  return str.trim().length == 0
}

function validateCarItemPayload(payload: CartItemPayload): Vec<string>{
  const errors: Vec<string> = [];
  if (isInvalidString(payload.name)){
      errors.push(`Name must not be empty. Current name='${payload.name}'.`)
  }
  if (payload.price <= 0){
      errors.push(`Price cannot be a negative value or zero. Current price='${payload.price}'.`)
  }
  if (payload.quantity == 0){
      errors.push(`Quantity needs to be positive. Current quantity='${payload.quantity}'.`)
  }
  return errors;
}
// Helper function to ensure the input id meets the format used for ids generated by uuid
function isValidUuid(id: string): boolean {
  const regexExp = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/gi;
  return regexExp.test(id);
}
  
  // Get all carts
  $query;
  export function getCarts(): Result<Vec<Cart>, string> {
    try {
      return Result.Ok(cartStorage.values());
    } catch (error: any) {
      return Result.Err(`Failed to retrieve carts: ${error}`);
    }
  }
  
  // Get a cart by ID
  $query;
  export function getCart(id: string): Result<Cart, string> {
    if (!isValidUuid(id)){
      return Result.Err(`id='${id}' is not in the valid uuid format.`)
    }
    const cartOpt = cartStorage.get(id);
    return match(cartOpt, {
      Some: (cart) => Result.Ok<Cart, string>(cart),
      None: () => Result.Err<Cart, string>(`A cart with ID=${id} not found.`),
    });
  }
  
  // Create a new cart
  $update;
  export function createCart(): Result<Cart, string> {
    try {

      const cart: Cart = {
        id: uuidv4(),
        principal: ic.caller(),
        createdAt: ic.time(),
        updatedAt: Opt.None,
        cartItems: [],
        totalPrice: 0
      };
  
      cartStorage.insert(cart.id, cart);
  
      return Result.Ok<Cart, string>(cart);
    } catch (error: any) {
      return Result.Err<Cart, string>(`Failed to create a new cart: ${error}`);
    }
  }
  
  // Delete a cart
  $update;
  export function deleteCart(id: string): Result<Cart, string> {
    // Validate cart ID
    if (!isValidUuid(id)){
      return Result.Err(`id='${id}' is not in the valid uuid format.`)
    }
    const cartOpt = cartStorage.get(id);
  
    return match(cartOpt, {
      Some: (cart) => {
        if (cart.principal.toString() !== ic.caller().toString()){
          return Result.Err<Cart, string>("Caller isn't the principal of the cart") 
        }
          
        const cartItems = cartItemStorage.values().filter(
          (cartItem) =>
            cartItem.cartId === id
        );
  
        cartItems.forEach((cartItem) => cartItemStorage.remove(cartItem.id));

        // Remove the cart and associated cart items
        cartStorage.remove(id);
  
        return Result.Ok<Cart, string>(cart);
      },
      None: () => Result.Err<Cart, string>(`Failed to delete cart with ID=${id}. Cart not found.`),
    });
  }
  
  // Add a cart item to a cart
  $update;
  export function addCartItem(payload: CartItemPayload, cartId: string): Result<CartItem, string> {
    // Validate cart ID
    if (!isValidUuid(cartId)){
      return Result.Err(`id='${cartId}' is not in the valid uuid format.`)
    }
    // Validate payload properties
    let payloadErrors = validateCarItemPayload(payload);
    if (payloadErrors.length) {
      return Result.Err<CartItem, string>(`Invalid payload. Errors=[${payloadErrors}]`);
    }
  
    const cartOpt = cartStorage.get(cartId);
  
    return match(cartOpt, {
      Some: (cart) => {
        if (cart.principal.toString() !== ic.caller().toString()){
          return Result.Err<CartItem, string>("Caller isn't the principal of the cart") 
        }
        const cartItem: CartItem = {
          id: uuidv4(),
          cartId: cartId,
          createdAt: ic.time(),
          updatedAt: Opt.None,
          ...payload,
        };
  
        cartItemStorage.insert(cartItem.id, cartItem);
  
        cart.cartItems.push(cartItem.id);
        cart.updatedAt = Opt.Some(ic.time());
        cart.totalPrice = calculateTotalPrice(cart);
        cartStorage.insert(cartId, cart);
  
        return Result.Ok<CartItem, string>(cartItem);
      },
      None: () => Result.Err<CartItem, string>(`Failed to add cart item. Cart with ID=${cartId} not found.`),
    });
  }
  
  // Update a cart item in a cart
  $update;
  export function updateCartItem(payload: CartItemPayload, cartItemId: string): Result<CartItem, string> {
    // Validate cart item ID
    if (!isValidUuid(cartItemId)){
      return Result.Err(`id='${cartItemId}' is not in the valid uuid format.`)
    }
    // Validate payload properties
    let payloadErrors = validateCarItemPayload(payload);
    if (payloadErrors.length) {
      return Result.Err(`Invalid payload. Errors=[${payloadErrors}]`);
    }
  

    const cartItemOpt = cartItemStorage.get(cartItemId);
  
    return match(cartItemOpt, {
      Some: (cartItem) => {
        const updatedCartItem: CartItem = {
          ...cartItem,
          updatedAt: Opt.Some(ic.time()),
          ...payload,
        };
  
  
        const cartOpt = cartStorage.get(cartItem.cartId);
  
        return match(cartOpt, {
          Some: (cart) => {
            if (cart.principal.toString() !== ic.caller().toString()){
              return Result.Err<CartItem, string>("Caller isn't the principal of the cart") 
            }
            cartItemStorage.insert(cartItemId, updatedCartItem);
            cart.updatedAt = Opt.Some(ic.time());
            cart.totalPrice = calculateTotalPrice(cart);
            cartStorage.insert(cart.id, cart);
            return Result.Ok<CartItem, string>(updatedCartItem);
          },
          None: () => Result.Err<CartItem, string>(`Failed to update cart item. Cart with ID=${cartItem.cartId} not found.`),
        });
      },
      None: () => Result.Err<CartItem, string>(`Failed to update cart item. Cart item with ID=${cartItemId} not found.`),
    });
  }
  
  // Get all cart items in a cart
  $query;
  export function getCartItems(cartId: string): Result<Vec<CartItem>, string> {
    // Validate cart ID
    if (!isValidUuid(cartId)){
      return Result.Err(`id='${cartId}' is not in the valid uuid format.`)
    }
    
    const cartOpt = cartStorage.get(cartId);
  
    return match(cartOpt, {
      Some: (cart) => {
        const cartItems = cartItemStorage.values().filter(
          (cartItem: CartItem) =>
            cartItem.cartId === cart.id
        );
  
        return Result.Ok<Vec<CartItem>, string>(cartItems);
      },
      None: () => Result.Err<Vec<CartItem>, string>(`Failed to retrieve cart items. Cart with ID=${cartId} not found.`),
    });
  }
  
  // Workaround to make uuid package work with Azle
  globalThis.crypto = {
    // @ts-ignore
    getRandomValues: () => {
      let array = new Uint8Array(32);
  
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
  
      return array;
    }
  };
  
  // Function to calculate total price for a cart
  function calculateTotalPrice(cart: Cart) {
  
    const cartItems = cartItemStorage.values().filter(
      (cartItem: CartItem) =>
        cartItem.cartId === cart.id
    );
  
    let totalPrice = 0;
  
    cartItems.forEach((cartItem: CartItem) => totalPrice += cartItem.price * cartItem.quantity)
  
    return totalPrice;
  }
  